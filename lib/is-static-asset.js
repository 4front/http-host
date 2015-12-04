
// Extensions for common web static assets types
var otherRegex =
  /\.(js|css|ico|swf|svg|json|txt|eot|ttf|woff|otf|tsv|csv|xml|woff2|markdown|md|pdf|mp3)$/;

var imageRegex = /\.(jpg|jpeg|png|gif)$/;
var videoRegex = /\.(webm|flv|mp4|ogg|flv|wav)$/;
var htmlRegex = /\.html$/;

module.exports = {
  anyExceptHtml: function(req) {
    return otherRegex.test(req.path) ||
      imageRegex.test(req.path) ||
      videoRegex.test(req.path);
  },
  html: function(req) {
    return htmlRegex.test(req.path);
  },
  image: function(req) {
    return imageRegex.test(req.path);
  },
  video: function(req) {
    return videoRegex.test(req.path);
  },
  htmlXhr: function(req) {
    return htmlRegex.test(req.path) && req.xhr === true;
  },
  htmlNotXhr: function(req) {
    return htmlRegex.test(req.path) && req.xhr !== true;
  }
};
