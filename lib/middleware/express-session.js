
// Just a pass-through to the real express-session.
// We do this simply so the virtual-router can 
// require in a consistent way.
module.exports = require('express-session');