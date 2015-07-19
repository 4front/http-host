
// Invalid plugin that returns a function with only one arg.
module.exports = function(options) {
  return function(arg) {
  };
};
