var _ = require('lodash');

require('simple-errors');


// Pick a version by evaluating a set of rules. The
// first rule to evaluate to true wins.
var ruleRegistry = {
  '*': function() {
    // The fixed rule always returns true
    return true;
  },
  random: function(percent) {
    // X percent random chance of being selected
    return (percent <= _.rand(1, 100)/100);
  }
};

module.exports = function(rules) {
  for (var i=0; i<rules.length; i++) {
    var ruleName = rules[i].rule;

    // Lookup the rule
    var rule = ruleRegistry[ruleName];
    if (!rule)
      throw new Error("Invalid rule " + ruleName);

    var args = null;
    if (rules[i].args) {
      try {
        args = JSON.parse(rules[i].args);
      }
      catch (err) {
        throw new Error("Could not parse arg for rule " + ruleName + " as JSON");
      }
    }

    try {
      if (rule(args) === true)
        return rules[i].versionId;
    }
    catch (err) {
      throw new Error("Error encountered evaluating rule " + ruleName);
    }
  }

  return null;
};
