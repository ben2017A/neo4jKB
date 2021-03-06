// dependencies
var _ = require('lomath');

// full op restored by using query()
// Query string CFG parse tree, legalization to clean query string and prevent SQL injection.

// shits that can add more power, not using raw query():
// 1. <wOp> by WHERE
// WHERE functions:
// operators: =, <>, <, >, <=, >=, IS NULL, and IS NOT NULL
// boolean: AND, OR, XOR, NOT
// string: concat +, regex =~
// chaining ops is allowed, e.g. a < b < c
// predicates: EXISTS
// collection: labels, keys

// 2. <rOp> on returned res:
// ORDER BY
// LIMIT
// aggr: COUNT, sum, avg, percentileDisc, percentileCont, stdev, stdevp, max, min, collect, distinct

// exclude graph algo for now. build in later
// 3. <graphOp> graph algorithms like dijkstra too
// Try to generalize to graph, not node-only, operations
// http://neo4j.com/docs/stable/rest-api-graph-algos.html
// p = shortestPath((martin)-[*..15]-(oliver))
// p = allShortestPaths((martin)-[*]-(michael))
// MATCH p=shortestPath((a)-[*..5]-(b)) RETURN DISTINCT(nodes(p))

// Query string formats for pullGraph:
// MATCH (a:LabelA {propA}) <wOp> <rOp>
// MATCH (a:LabelA {propA})-[e:LabelE ({propE}|*Dist)]-(b:LabelB {propB}) <wOp> <rOp>
// MATCH p=shortestPath( (a:LabelA {propA})-[e:LabelE ({propE}|*Dist)]-(b:LabelB {propB}) ) <wOp> <rOp>

// generate regex for Heads from arrays
function genHeadRe(arr0, arr1) {
  var reStr = "^\\s*(" + _.concat.apply(this, arguments).join('|') + ")\\s*"
  return new RegExp(reStr, "i")
}
// generate regex for Ops from arrays
function genOpsRe(arr0, arr1) {
  var reStr = "\\s*(\?:" + _.concat.apply(this, arguments).join('|') + ")\\s*"
  return new RegExp(reStr, "gi")
}

// the regex fields for parsetree cleaning
// for WHERE fields
var wOpsHead = ['WHERE']
var wOpsHeadRe = genHeadRe(wOpsHead)
var wOps0 = ['AND', 'OR', 'XOR', 'NOT']
var wOps1 = ['=~', '=', '<>', '<=', '>=', '<', '>', 'IS NULL', 'IS NOT NULL', '\\+']
var wOps2 = ['EXISTS', 'nodes', 'labels', 'keys']
var wOpsRe = genOpsRe(wOps0, wOps1, wOps2, wOpsHead)

// for SET | REMOVE fields
var sOpsHead = ['SET', 'REMOVE']
var sOpsHeadRe = genHeadRe(sOpsHead)
var sOps0 = [',', '=', '\\+=', ':']
var sOpsRe = genOpsRe(sOps0, sOpsHead)

// for RETURN | DELETE | DETACH DELETE fields
var rOpsHead = ['RETURN', 'DETACH DELETE', 'DELETE']
var rOpsHeadRe = genHeadRe(rOpsHead)
var rOps0 = [',', 'ORDER BY', 'LIMIT', 'COUNT', 'sum', 'avg', 'percentileDisc', 'percentileCont', 'stdev', 'stdevp', 'max', 'min', 'collect', 'DISTINCT', 'nodes', 'labels', 'keys']
var rOpsRe = genOpsRe(rOps0, rOpsHead)

// for SHORTESTPATH|ALLSHORTESTPATHS, but is parsed different into query string
var pOpsHead = ['ALLSHORTESTPATHS', 'SHORTESTPATH']
var pOpsHeadRe = genHeadRe(pOpsHead)

// all the ops head regex
var allOpsHeadRe = genHeadRe(wOpsHead, sOpsHead, rOpsHead, pOpsHead)

// console.log(_.concat(wOps0, wOps1, wOps2, sOps0, rOps0).join())
// console.log(_.concat(wOpsHead, sOpsHead, rOpsHead, pOpsHead).join())

// The main cons object for export
/**
 * The constrain object for KB. has many convenience methods.
 * Call via KB.cons.<method>
 * @type {Object}
 */
var cons = {
  // okay imposing constraint must go with a Label,
  // so needa search all
  nodeConstraints: [
    'MATCH (n) RETURN DISTINCT(labels(n))',
    'CREATE CONSTRAINT ON (n:user) ASSERT n.hash IS UNIQUE'
  ],

  // the list of checkable mandatory fields
  // there are also 'created_by' and 'created_when', but is built in to the KB_builder method of pushNode
  mandatoryFields: ['hash_by', 'hash', 'updated_by', 'updated_when'],

  /**
   * Generate an object of mandatoryFields with default values for extension.
   * @private
   * @param  {JSON} [res] For the robot to extract user id.
   * @return {JSON} mandatoryFieldsObject with default values.
   */
  generateMandatoryFields: function(res) {
    var author = _.get(res, 'envelope.user.id') || 'bot'
    return _.zipObject(cons.mandatoryFields, ['hash', 'test', author, cons.now()])
  },

  /**
   * Generates the current timestamp in ISO 8601 format, e.g. 2016-01-22T14:42:27.579Z
   * @return {string} ISO 8601 timestamp string, e.g. '2016-01-22T14:42:27.579Z'
   */
  now: function() {
    return (new Date()).toJSON()
  },

  /**
   * Updates the prop's hash as demanded by its 'hash_by'. Mutates the object.
   * @private
   * @param  {JSON} prop The property object
   * @return {JSON}      The updated prop
   *
   * @example
   * var prop = {name: 'A', hash_by: 'name'}
   * cons.updateHash(prop)
   * // => { name: 'A', hash_by: 'name', hash: 'A' }
   *
   * // prop1 has no 'age'
   * var prop1 = {name: 'A', hash_by: 'age'}
   * cons.updateHash(prop)
   * // Error: The empty field, age, cannot be used as hash
   * 
   */
  updateHash: function(prop) {
    if (_.isNull(prop[prop.hash_by]) || _.isUndefined(prop[prop.hash_by])) {
      throw new Error("Node constraints violated: The empty field, " + prop.hash_by + ", cannot be used as hash as demanded by 'hash_by'");
    }
    return _.set(prop, 'hash', prop[prop.hash_by])
  },

  /**
   * Legalize a prop obj by inserting the missing mandatory fields with default values. Automatically flattens the JSON with key delimiter '__' since neo4J doesn't take a deep JSON. Also updates the hash as demanded by 'hash_by', and you can supply the 'hash_by' key as an argument. Mutates the object. Used mainly for testing. Use with care.
   * @param  {JSON} prop The properties object for KB node.
   * @param  {JSON} [res] For the robot to extract user id.
   * @param  {string} [hash_by] Specify and set the hash_by key and update it internally.
   * @return {JSON}      mutated prop that is now legal wrt the constraints.
   *
   * @example
   * var prop = {name: 'A', hash_by: 'name'}
   * cons.legalize(prop)
   * // => { name: 'A',
   * // hash_by: 'name',
   * // hash: 'A',
   * // updated_by: 'bot',
   * // updated_when: 1452802513112 }
   *
   * // supplying the 'hash_by' key
   * var prop0 = {name: 'A'}
   * cons.legalize(prop0, 'name')
   * // => { name: 'A',
   * // hash_by: 'name',
   * // hash: 'A',
   * // updated_by: 'bot',
   * // updated_when: 1452802513112 }
   * 
   * var prop1 = {name: 'A', hash_by: 'name', meh: { a:1 }}
   * cons.legalize(prop1)
   * // => { name: 'A',
   * // meh__a: 1,
   * // hash_by: 'name',
   * // hash: 'A',
   * // updated_by: 'bot',
   * // updated_when: 1452802513112 }
   * 
   * // quick constructor of a legal prop
   * cons.legalize('A')
   * // { name: 'A',
   * //   hash_by: 'name',
   * //   hash: 'A',
   * //   updated_by: 'bot',
   * //   updated_when: '2016-02-01T20:34:02.582Z' }
   *
   * cons.legalize('A', 'updated_when')
   * // { name: 'A',
   * //   hash_by: 'updated_when',
   * //   hash: '2016-02-01T20:34:02.603Z',
   * //   updated_by: 'bot',
   * //   updated_when: '2016-02-01T20:34:02.603Z' }
   *
   */
  legalize: function(prop, res, hash_by) {
    if (_.isString(prop)) {
      prop = {
        name: prop,
        hash_by: 'name'
      }
    };
    var hash_key = _.find([res, hash_by], _.isString)
    if (hash_key) {
      prop['hash_by'] = hash_key
    };
    return cons.updateHash(_.flattenJSON(_.defaults(prop, cons.generateMandatoryFields(res)), '__'))
  },

  /**
   * The opposite of legalize: Return a new prop with its mandatoryFields removed. Does not mutate object. Used to yield cleaner prop.
   * @param  {JSON} prop    The prop to illegalize.
   * @return {JSON}         Prop without the mandatory fields.
   *
   * @example
   * var prop = {name: 'A'}
   * cons.legalize(prop)
   * // => prop = { name: 'A',
   *   hash_by: 'hash',
   *   hash: 'test',
   *   updated_by: 'bot',
   *   updated_when: '2016-02-01T22:02:34.822Z' }
   *   
   * cons.illegalize(prop)
   * // => { name: 'A' }
   */
  illegalize: function(prop) {
    return _.omit(prop, cons.mandatoryFields.concat(['created_by', 'created_when']))
  },

  /**
   * Format a Neo4j Label string into lower case, single spaced. Has SQL-injection prevention.
   * If NODE_ENV is 'development', it prepends 'test_' to labelStr (if not already exists prepended).
   * @private
   * @param  {string} labelStr The label string
   * @return {string}          formattedString
   * 
   * @example
   * cons.formatLabel('dis a COOL  label')
   * // => 'this a cool label'
   */
  formatLabel: function(labelStr) {
    labelStr = labelStr || ''
    if (String(process.env.NODE_ENV).toLowerCase() == 'development') {
      labelStr = labelStr.replace(/^(test_|)/i, 'test_')
    };
    var legal = cons.isAtomic(labelStr);
    // SQL injection scan here
    if (!legal) {
      throw new Error("individual label cannot contain space.")
    };
    return labelStr ? labelStr.toLowerCase().replace(/\s+/g, ' ') : ''
  },
  /**
   * Turn labels (single arg) into proper format for neo4j.
   * @private
   * @param  {string|Array} labels A single string, or an array of strings
   * @return {string}        labelString
   *
   * @example
   * cons.stringifyLabel('')
   * cons.stringifyLabel(undefined)
   * cons.stringifyLabel(null)
   * // => ''
   * 
   * cons.stringifyLabel('label1')
   * // => ':label1 '
   *
   * cons.stringifyLabel(['label1', 'label2'])
   * // => ':label1:label2 '
   * 
   */
  stringifyLabel: function(labels) {
    if (labels && !_.isArray(labels)) {
      labels = [labels]
    };
    return labels ? ':' + _.map(labels, cons.formatLabel).join(':') + ' ' : '';
  },

  /**
   * Extract dist from propDist and turn it into proper format for neo4j.
   * @private
   * @param  {JSON|string} propDist An ambiguous prop JSON or dist string.
   * @return {string}        distString
   *
   * @example
   * cons.stringifyLabel('0..1')
   * cons.stringifyLabel({name: "A"})
   * // => ''
   * 
   * cons.stringifyLabel('*..2')
   * // => ' *..2'
   * 
   */
  stringifyDist: function(propDistE) {
    return (_.isString(propDistE) && _.startsWith(propDistE, '*')) ? ' ' + propDistE : ''
  },

  /**
   * Check if props has all the mandatory keys, with non-null/non-undefined values. Internally updates the hash as demanded by 'hash_by' for you.
   * @private
   * @param  {JSON}  props The JSON properties to be passed into query
   * @return {Boolean}       Whether it has all the mandatory fields.
   *
   * @example
   * var prop = {
   *  hash: 'hashStr0',
   *  hash_by: null,
   *  url: 'justanotherurl',
   *  name: 'A Design Document'
   * }
   * cons.pass(prop) // missing hash_by
   * // => throws Error: Node constraints violated.
   * 
   * var prop1 = {
   *  hash: 'hashStr0',
   *  hash_by: 'name',
   *  url: 'justanotherurl',
   *  name: 'A Design Document'
   * }
   * cons.pass(prop1) // missing 'name' as demanded by 'hash_by'
   * // => throws Error: Node constraints violated.
   *
   * // make it legal
   * cons.legalize(prop1)
   * // prop1 is now legal
   * // => prop1 = { hash: 'A Design Document',
   * // hash_by: 'name',
   * // url: 'justanotherurl',
   * // name: 'A Design Document',
   * // updated_by: 'bot',
   * // updated_when: 1452802842068 }
   *
   * cons.pass(prop1)
   * // => true
   */
  pass: function(prop) {
    // update the hash first
    cons.updateHash(prop)
      // then check the signatures
    var fieldSig = _.prod(
      _.map(cons.mandatoryFields, function(field) {
        return _.has(prop, field) && !_.isUndefined(prop[field]) && !_.isNull(prop[field]) ? true : false;
      }))
    if (!fieldSig) throw new Error("Node constraints violated: incomplete mandatoryFields.")

    // finally both passed
    return true;
  },

  /**
   * Check if the string is a WHERE operation string and is legal.
   * @private
   * @param  {string}  str WHERE sentence.
   * @return {Boolean}     
   */
  isWOp: function(str) {
    var startsWith = !_.isNull(str.match(wOpsHeadRe))
    return startsWith & cons.isLegalSentence(str)
  },

  /**
   * Check if the string is a SET|REMOVE operation string and is legal.
   * @private
   * @param  {string}  str WHERE sentence.
   * @return {Boolean}     
   */
  isSOp: function(str) {
    var startsWith = !_.isNull(str.match(sOpsHeadRe))
    return startsWith & cons.isLegalSentence(str)
  },

  /**
   * Check if the string is a RETURN|DELETE|DETACH DELETE operation string and is legal.
   * @private
   * @param  {string}  str RETURN sentence.
   * @return {Boolean}     
   */
  isROp: function(str) {
    var startsWith = !_.isNull(str.match(rOpsHeadRe))
    return startsWith & cons.isLegalSentence(str)
  },

  /**
   * Check if the string is a SHORTESTPATH|ALLSHORTESTPATHS operation string and is legal.
   * @private
   * @param  {string}  str PATH sentence.
   * @return {Boolean}     
   */
  isPOp: function(str) {
    var startsWith = !_.isNull(str.match(pOpsHeadRe))
    return startsWith & cons.isLegalSentence(str)
  },

  /**
   * Check if the string is a RETURN operation string and is legal, to prevent SQL injection.
   * Algo (str):
   * 1. replace "(" and ")" globally
   * 2. split by <op> globally, trim spaces, into variables
   * 3. check if each variable is legally atomic (shan't be split further): either contains no space "\s+" and no quotes "\", \'" at all, or is a proper quoted string with quotes on the boundaries but not the inside.
   *
   * A sentence is a clause starting with the following query operation specifier: `WHERE,SET,REMOVE,RETURN,DELETE,DETACH DELETE,SHORTESTPATH,ALLSHORTESTPATHS`
   * The sentence also consists of variables and operators <op>. The permissible operators by this algorithm are `AND,OR,XOR,NOT,=,<>,<,>,<=,>=,IS NULL,IS NOT NULL,+,+=,=~,EXISTS,nodes,labels,keys,",",=,ORDER BY,LIMIT,COUNT,sum,avg,percentileDisc,percentileCont,stdev,stdevp,max,min,collect,DISTINCT,nodes,labels,keys`
   * 
   * Proof: 
   * Some terminologies: A sentence is a string that can properly evaluate to its output. It consists of operators and variables. Operators (single argument on either side here) operate on a single variable on either side (left and right) to yield another variable.
   * We can take the CFG parse tree of the whole string, split by the ops. We do not care about operator precedence in checking the legality of the string. Also note that parentheses "(", ")" exists only to assert operator precedence to give an unambiguous parse tree, thus removing them entirely is simply making the tree flat, i.e. all operations run from left to right.
   * Furthermore, note that from the terminologies we can see that in a sentence, there can only be adjacent occurence of operators, but not of variables. This can also be seen from the parse tree, where the sentence is split by operators, and variables are the leaves. Leaves are always atomic. This justifies our algorithm.
   * 
   * @param  {string}  str A sentence of Ops and Variables.
   * @return {Boolean}     
   */
  isLegalSentence: function(str) {
    // if string is empty, just true
    if (!str) {
      return true;
    };
    // else proceed with matching the right regex
    var re;
    if (str.match(wOpsHeadRe)) {
      re = wOpsRe
    } else if (str.match(sOpsHeadRe)) {
      re = sOpsRe
    } else if (str.match(rOpsHeadRe)) {
      re = rOpsRe
    } else if (str.match(pOpsHeadRe)) {
      // pOp is slightly different: SHORTESTPATH arg must be empty
      if (_.trim(str.replace(pOpsHeadRe, ''))) {
        throw new Error("Your " + pOpsHeadRe.toString() + " sentence argument must be empty.")
      } else {
        return true
      }
    } else {
      throw new Error("Your sentence does not match " + allOpsHeadRe.toString() + " type.")
    }
    // 1. replace parentheses globally, trim spaces to single space
    var tailStr = _.trim(str.replace(allOpsHeadRe, '').replace(/\(|\)/g, ' ').replace(/\s{2,}/g, ' '))
    if (!tailStr) {
      throw new Error("Your " + allOpsHeadRe.toString() + " sentence argument cannot be empty.")
    };
    // 2. split by <op> globally
    var fullSplit = tailStr.split(re);
    // 3.check legality
    // console.log("tailStr:", tailStr, re)
    // console.log("fullSplit", fullSplit)
    var legal = _.prod(_.map(fullSplit, cons.isLegalAtom));
    // console.log(legal)
    return legal;
  },


  /**
   * Check if a string is a legal atomic variable.
   * @private
   * @param  {string}  str 
   * @return {Boolean}     
   */
  isLegalAtom: function(str) {
    return cons.isAtomic(str) || cons.isQuoted(str)
  },
  /**
   * Check if a string is not a quote and contains no space.
   * @private
   * @param  {string}  str 
   * @return {Boolean}     
   */
  isAtomic: function(str) {
    return _.isNull(str.match(/"|'|\s+/g))
  },
  /**
   * Check if a string is a proper atomic quote: without internal quotes.
   * @private
   * @param  {string}  str 
   * @return {Boolean}     
   */
  isQuoted: function(str) {
    return (_.startsWith(str, '"') && _.endsWith(str, '"') && !_.includes(_.trim(str, '"'), '"')) ||
      (_.startsWith(str, "'") && _.endsWith(str, "'") && !_.includes(_.trim(str, "'"), "'"))
  }

}


module.exports = cons
