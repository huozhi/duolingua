const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

const App = struct {
    env_map: *std.process.Environ.Map,

    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name = "duolingua",
            .source = native_sdk.frontend.productionSource(.{ .dist ="frontend/out" }),
            .source_fn = source,
        };
    }

    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist ="frontend/out",
            .entry = "index.html",
        });
    }
};

const app_origins = [_][]const u8{
    "zero://app",
    "zero://inline",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3219",
};

pub fn main(init: std.process.Init) !void {
    var app = App{ .env_map = init.environ_map };
    try runner.runWithOptions(app.app(), .{
        .app_name = "duolingua",
        .window_title = "duolingua",
        .bundle_id = "app.duolingua.translator",
        .icon_path = "assets/icon.png",
        .security = .{
            .navigation = .{ .allowed_origins = &app_origins },
        },
    }, init);
}

test "app name is configured" {
    try std.testing.expectEqualStrings("duolingua", "duolingua");
}
