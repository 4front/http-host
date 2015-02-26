var debug = require('debug')('4front:helper');

// Determine which html page to render.
module.exports.determineHtmlPage = function(req, ensureAuthenticated) {
  // If authentication is required for this app and req.isAuthenticated returns false
  // set the pageName to the public page.
  if (ensureAuthenticated === true) {
    if (req.ext.isAuthenticated === true) {
      debug("user is authenticated, show the private index page");
      return req.ext.virtualApp.privatePage || 'index';
    }
    else {
      debug("user is not authenticated, show the public index page");
      return req.ext.virtualApp.publicPage || 'login';
    }
  }
  else
    return req.ext.virtualApp.indexPage || 'index';
};