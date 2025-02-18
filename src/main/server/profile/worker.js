// (Tyler, 06/07/21)
// The code here seems to work, though the accuracy of its output hasn't been completely validated.
// The logic for computing profile state properties (in post-processing step) must be reviewed.
// See TODO and CHECKME comments for more

// General notes
// * Triple - Stored as an edge in EcFrameworkGraph.edges, has:
//     * 'edge' (typeof any, but usually an EcAlignment)
//     * 'destination' (typeof vertex), and
//     * 'source' (typeof vertex)
// * EcFrameworkGraph - Is it a DAG? "EcDirectedGraph (may have multiple edges between two vertices)"
//     * g.addFramework - Adds vertices
//     * g.verticies - Competencies (typo in name)
//     * g.edges - Store Triples
//     * g.metaVerticies - Objects we can use to store information attached to each vertex
//                         Also modified by g.processAssertionsBoolean
//     * ? g.metaEdges - Unused
//     * g.getMetaStateCompetency(EcCompetency)
//     * g.processAssertionsBoolean(assertions, success, failure)
//         * Helper method to populate the graph with assertion data
//         * Populates each metaVertex's .positiveAssertion and .negativeAssertion properties
//         * Based on propagation rules implicit in the relations (see devs.cassproject.org, Relations)
//         * Does not draw conclusions
//         * "Must be able to decrypt 'negative' value"
// Algorithm:
//         The goal is to return an object holding a hierarchy of competencies, sourced from a single framework as well
//         as all frameworks attached to it through Relations (EcAlignments). Each competency will have information
//         attached to it including the related frameworks, resource alignments, the user's goals, assertions on the
//         user, and other information regarding how the goals & assertions relate to other related competencies (by
//         looking at relevant Relations).
//
//         An EcFrameworkGraph is constructed holding the given framework as well as all outside frameworks connected
//         by outside competencies within the graph's edges (Triple objects). This graph holds Vertices (which are
//         competencies) connected by these edges (which store EcRelations), as well was MetaVertices which are nothing
//         more than auxilliary storage containers for each competency (besides being populated with graph's
//         processAssertionsBoolean). We'll use the MetaVertices to store all information attached to each competency.
//         Once all relevant information is retrieved, we'll repeatedly iterate over each edge to update information
//         inside each meta-vertex based on how the edges' Relations (EcAlignments) relate to goals & assertions

const https = require('https');

const envHttp2 = process.env.HTTP2 != null ? process.env.HTTP2.trim() == 'true' : true;
let app;
if (!envHttp2)
{
    global.axios = require("axios"); //Pre-empt http2 use.
}
require("cassproject");
global.hasher = require('node-object-hash');

const envHttps = process.env.HTTPS != null ? process.env.HTTPS.trim() == 'true' : false;

global.repo = new EcRepository();
repo.selectedServer = process.env.CASS_LOOPBACK || (envHttps ? "https://localhost/api/" : "http://localhost/api");
if (envHttps)
{
    https.globalAgent.options.rejectUnauthorized = false;
}
repo.selectedServerProxy = process.env.CASS_LOOPBACK_PROXY || null;

EcRepository.caching = true;
EcRepository.cachingSearch = true;
EcCrypto.caching = true;

const PRECACHE_ALL_FRAMEWORKS = true;
let allFrameworks = global.allFrameworks = []; // Cache of all frameworks
let profileFrameworks = global.profileFrameworks = {}; //Cache of constructed frameworks

// Access the workerData by requiring it.
let {parentPort, workerData} = require('worker_threads');

let initialized = false;

let glob = require('glob');
let path = require('path');
const EcPk = require("cassproject/src/com/eduworks/ec/crypto/EcPk");

global.auditLogger = require(path.resolve(glob.sync( 'src/main/server/shims/auditLogger.js' )[0]));

let ProfileCalculator = require(path.resolve(glob.sync( 'src/main/server/profile/calculator.js' )[0]));

global.lastFlush = Date.now();
// Main thread will pass the data you need through this event listener.
parentPort.on('message', async(param) => {
    const subject = param.subject;
    const frameworkId = param.frameworkId;
    const query_agent = param.query_agent;

    let userChanged = true;
    if (EcIdentityManager.default.ids.length > 0)
        if (EcIdentityManager.default.ids[0].ppk.toPem() == query_agent);
            userChanged = false;
    EcIdentityManager.default.clearIdentities();
    if (param.lastFlush != global.lastFlush)
    {
        global.lastFlush = param.lastFlush;
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.INFO, "WorkerMessage", "Flushing cache (cause: new Assertions).");
        EcRepository.cache = {};
    }
    if (param.flushCache == "true")
    {
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.INFO, "WorkerMessage", "Flushing cache.");
        EcRepository.cache = {};
        allFrameworks = global.allFrameworks = [];
        profileFrameworks = global.profileFrameworks = {};
    }
    if (userChanged)
    {
        EcCrypto.cache = {};
        EcRepository.cache = {};
    }

    global.agent = new EcIdentity();
    agent.ppk = EcPpk.fromPem(query_agent);
    agent.displayName = "User";
    EcIdentityManager.default.addIdentity(agent);

    let cacheInsertCounter = 0;

    if (!initialized) {
        initialized = true;
        if (workerData.repoCache != null) {
            for (let key in workerData.repoCache) {
                if (EcRepository.cache[key] == null) {
                    EcRepository.cache[key] = new EcRemoteLinkedData();
                    EcRepository.cache[key].copyFrom(workerData.repoCache[key]);
                    cacheInsertCounter++;
                }
            }
        }

        if (workerData.cryptoCache != null) {
            for (let key in workerData.cryptoCache) {
                if (EcCrypto.decryptionCache[key] == null) {
                    EcCrypto.decryptionCache[key] = workerData.cryptoCache[key];
                    cacheInsertCounter++;
                }
            }
        }

        if (workerData.allFrameworks != null) {
            allFrameworks = [];
            for (let framework of workerData.allFrameworks) {
                let f = new EcFramework();
                f.copyFrom(framework);
                allFrameworks.push(f);
            }
        }
        workerData = null;
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.INFO, "WorkerMessage", `cache updated with ${cacheInsertCounter} items`);
    }
    if (allFrameworks.length == 0)
    {
        allFrameworks = await EcFramework.search(repo,"*",null,null,{size:10000});
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.INFO, "WorkerMessage", `Profile Calculator: Fetched ${allFrameworks.length} frameworks for determining network effects.`);
    }

    const p = new ProfileCalculator();
    p.params = param.params;

    // Get necessary information on person from subject
    try {
        p.person = await global.anythingToPerson(subject);
        p.pem = await global.anythingToPem(subject);
        if (EcArray.isArray(p.pem))
            p.pk = p.pem.map((p)=>EcPk.fromPem(p));
        else
            p.pk = EcPk.fromPem(p.pem);
        if (EcArray.isArray(p.pk))
            p.fingerprint = p.pk.map((p)=>p.fingerprint());
        else
            p.fingerprint = p.pk.fingerprint();
    } catch (e) {
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.ERROR, "WorkerMessage", e);
        return;
    }

    // Get framework from ID
    p.frameworkId = frameworkId;
    try {
        p.framework = await EcFramework.get(frameworkId);
    } catch (e) {
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.ERROR, "WorkerMessage", e);
        throw e;
    }

    let profile = await p.calculate();
    try {
        // return the result to main thread.
        // FR: Somewhere sometimes there's a promise being put in this data structure.
        parentPort.postMessage(JSON.parse(JSON.stringify(profile)));
    } catch (ex) {
        global.auditLogger.report(global.auditLogger.LogCategory.PROFILE, global.auditLogger.Severity.ERROR, "WorkerMessage", e);
        parentPort.postMessage({error: ex});
        throw ex;
    }
});