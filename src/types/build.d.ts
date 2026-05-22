// Globals injected by vite.config.ts `define`. The build SHA is the
// most useful one — when a user reports "the poster looks wrong on my
// phone" we need to know which deploy they're seeing without trusting
// the network (cached HTML can lie about its bundle's age).
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
