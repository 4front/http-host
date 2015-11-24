
// Returns a function with the wrong arg names. Function args must
// be req, res, next or err, req, res, next
module.exports = function(options) {
  return function(aaaa, bbbb, cccc) { // eslint-disable-line
  };
};
