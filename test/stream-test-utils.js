var stream = require('stream');
// var sbuff = require('simple-bufferstream');

module.exports = {
  emitter: function(eventName, context) {
    var rs = stream.Readable();
    rs._read = function() {
      // TODO: If context is an array use call to invoke
      rs.emit(eventName, context);
      rs.push(null);
      rs.emit('finish');
    };
    return rs;
  },

  // Provide a readable stream wrapper around a string
  buffer: function(contents) {
    var rs = stream.Readable();
    rs._read = function() {
      var self = this;
      this.emit('readable');
      process.nextTick(function() {
        self.emit('data', contents);
        self.emit('end');
      });
    };

    return rs;
  }
};
