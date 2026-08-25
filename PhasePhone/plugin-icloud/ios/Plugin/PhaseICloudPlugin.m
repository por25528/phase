#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor's ObjC registration macro. `CAPBridgedPlugin` conformance in the
// Swift class covers modern Capacitor; this keeps the plugin discoverable the
// classic way too, which is what `npx cap sync` still scans for.
CAP_PLUGIN(PhaseICloudPlugin, "PhaseICloud",
           CAP_PLUGIN_METHOD(readStateFile, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(readJournal, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(appendOp, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(rewriteJournal, CAPPluginReturnPromise);
)
