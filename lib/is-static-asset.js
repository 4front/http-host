
// Extensions for common web static assets types
var staticAssetExtensionRegex =
  /\.(jpg|jpeg|png|js|css|ico|gif|swf|svg|json|txt|eot|ttf|woff|otf|tsv|csv|xml|woff2|markdown|md)$/;

var htmlRegex = /\.html$/;

module.exports = {
  anyExceptHtml: function(req) {
    return staticAssetExtensionRegex.test(req.path);
  },
  html: function(req) {
    return htmlRegex.test(req.path);
  },
  htmlXhr: function(req) {
    return htmlRegex.test(req.path) && req.xhr === true;
  },
  htmlNotXhr: function(req) {
    return htmlRegex.test(req.path) && req.xhr !== true;
  }
};
