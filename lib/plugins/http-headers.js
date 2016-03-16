var _ = require('lodash');
var debug = require('debug')('4front-apphost:http-headers');

// Plugin for settings http headers.
// router: [
//   {
//     module: "http-headers",
//     path: "/img/backgrounds"
//     options: {
//       "Cache-Control": "public, max-age=1000000"
//     }
//   }
// ]
module.exports = function(options) {
  return function(req, res, next) {
    _.each(options, function(value, key) {
      res.setHeader(key, value);
    });

    next();
  };
};
