var Switch = function(onSwitch, switchedOn, switchName) {
    EcView.call(this);
    this.onSwitch = onSwitch;
    this.switchName = switchName;
    if (switchedOn != null) 
        this.switched = switchedOn;
};
Switch = stjs.extend(Switch, EcView, [], function(constructor, prototype) {
    prototype.onSwitch = null;
    prototype.switchName = null;
    prototype.switchId = null;
    prototype.switched = false;
    prototype.getHtmlLocation = function() {
        return "partial/other/switch.html";
    };
    prototype.display = function(containerId) {
        ($(containerId)).foundation();
        this.switchId = containerId + "-switch";
        if (this.switchName == null) 
            this.switchName = this.switchId.substring(1);
        $(containerId).find(".switch-input").prop("id", this.switchId.substring(1));
        $(containerId).find(".switch-input").prop("name", this.switchName);
        $(containerId).find(".switch-paddle").prop("for", this.switchName);
        if (this.switched) 
            $(this.switchId).prop("checked", this.switched);
        var me = this;
        $(this.switchId).change(stjs.bind(this, function(ev, THIS) {
            me.switched = !me.switched;
            if (me.onSwitch != null) 
                return me.onSwitch(ev, THIS);
            return true;
        }, 1));
    };
    prototype.isChecked = function() {
        return $(this.switchId).prop("checked");
    };
    prototype.setChecked = function(checked) {
        $(this.switchId).prop("checked", checked);
    };
}, {onSwitch: "EventHandler"}, {});
