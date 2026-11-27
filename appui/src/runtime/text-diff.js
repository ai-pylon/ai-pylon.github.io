/* Optional line comparison utility; no document or page state. */
const AppUITextDiff = (() => {
function lines(aLines, bLines, options = {}) {
    var n = aLines.length;
    var m = bLines.length;
    // For large files, use a simpler approach
    if (options.maxLines != null && n + m > options.maxLines) {
      return _simpleDiff(aLines, bLines);
    }
    if (n * m > (options.maxPairs ?? 4000000)) {
      if (options.fallback === 'position') return _simpleDiff(aLines, bLines);
      throw new Error('Select smaller sections to compare (maximum 4 million line pairs).');
    }
    // LCS table
    var dp = [];
    for (var i = 0; i <= n; i++) {
      dp[i] = [];
      for (var j = 0; j <= m; j++) {
        if (i === 0 || j === 0) dp[i][j] = 0;
        else if (aLines[i - 1] === bLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    // Backtrack
    var result = [];
    var ai = n, bi = m;
    while (ai > 0 || bi > 0) {
      if (ai > 0 && bi > 0 && aLines[ai - 1] === bLines[bi - 1]) {
        result.unshift({ type: 'equal', text: aLines[ai - 1], leftNum: ai, rightNum: bi });
        ai--; bi--;
      } else if (bi > 0 && (ai === 0 || dp[ai][bi - 1] >= dp[ai - 1][bi])) {
        result.unshift({ type: 'add', text: bLines[bi - 1], leftNum: null, rightNum: bi });
        bi--;
      } else {
        result.unshift({ type: 'remove', text: aLines[ai - 1], leftNum: ai, rightNum: null });
        ai--;
      }
    }
    return result;
  }
function _simpleDiff(aLines, bLines) {
    // Fallback for large files: line-by-line comparison
    var result = [];
    var maxLen = Math.max(aLines.length, bLines.length);
    for (var i = 0; i < maxLen; i++) {
      if (i < aLines.length && i < bLines.length) {
        if (aLines[i] === bLines[i]) {
          result.push({ type: 'equal', text: aLines[i], leftNum: i + 1, rightNum: i + 1 });
        } else {
          result.push({ type: 'remove', text: aLines[i], leftNum: i + 1, rightNum: null });
          result.push({ type: 'add', text: bLines[i], leftNum: null, rightNum: i + 1 });
        }
      } else if (i < aLines.length) {
        result.push({ type: 'remove', text: aLines[i], leftNum: i + 1, rightNum: null });
      } else {
        result.push({ type: 'add', text: bLines[i], leftNum: null, rightNum: i + 1 });
      }
    }
    return result;
  }
function changes(aLines, bLines, options) {
 const diff = lines(aLines, bLines, options), result = [];
 for (let index = 0; index < diff.length; index++) {
  const row = diff[index], next = diff[index + 1];
  if (row.type === 'remove' && next?.type === 'add') {
   result.push({type: 'changed', left: row.text, right: next.text, leftNum: row.leftNum, rightNum: next.rightNum}); index++;
  } else result.push({type: row.type === 'add' ? 'added' : row.type === 'remove' ? 'removed' : 'equal',
   left: row.type === 'add' ? '' : row.text, right: row.type === 'remove' ? '' : row.text,
   leftNum: row.leftNum, rightNum: row.rightNum});
 }
 return result;
}
function stats(diff) {
 const result = {added: 0, removed: 0, changed: 0};
 for (const row of diff) {
  const key = row.type === 'add' ? 'added' : row.type === 'remove' ? 'removed' : row.type;
  if (Object.hasOwn(result, key)) result[key]++;
 }
 return result;
}
return {lines, changes, stats};
})();
window.AppUITextDiff = AppUITextDiff;
