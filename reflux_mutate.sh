#!/bin/bash
# Injects deliberate defects and confirms each one turns a suite red.
# A mutation that is not caught is a gap in the tests, not a pass. A mutation
# whose target string no longer exists is also a gap: it has silently stopped
# testing anything, so it counts as a failure rather than being skipped.
SRC="${1:-reflux.html}"
pass=0; fail=0; stale=0
run(){ # name, old, new, suite
  cp "$SRC" mut.html
  python3 -c "
import sys,io
s=open('mut.html',encoding='utf-8').read()
old,new='''$2''','''$3'''
assert old in s, 'MUTATION TARGET NOT FOUND: $1'
open('mut.html','w',encoding='utf-8',newline='').write(s.replace(old,new,1))"
  if [ $? -ne 0 ]; then echo "STALE       $1  <-- target missing, mutation tests nothing"; stale=$((stale+1)); return; fi
  if node "$4" mut.html >/dev/null 2>&1; then echo "NOT CAUGHT  $1  <-- checker gap"; fail=$((fail+1));
  else echo "caught      $1"; pass=$((pass+1)); fi
}
runsplash(){ # name, old, new, [suite] -- mutates index.html, checks against the real SRC
  suite="${4:-reflux_checks.cjs}"
  [ -f index.html ] || { echo "STALE       $1  <-- index.html missing"; stale=$((stale+1)); return; }
  cp index.html .idx.bak
  python3 -c "
import sys,io
s=open('index.html',encoding='utf-8').read()
old,new='''$2''','''$3'''
assert old in s, 'MUTATION TARGET NOT FOUND: $1'
open('index.html','w',encoding='utf-8',newline='').write(s.replace(old,new,1))"
  if [ $? -ne 0 ]; then mv .idx.bak index.html; echo "STALE       $1  <-- target missing, mutation tests nothing"; stale=$((stale+1)); return; fi
  if node "$suite" "$SRC" >/dev/null 2>&1; then echo "NOT CAUGHT  $1  <-- checker gap"; fail=$((fail+1));
  else echo "caught      $1"; pass=$((pass+1)); fi
  mv .idx.bak index.html
}
runattrs(){ # name, old, new -- mutates .gitattributes, checks against the real SRC
  [ -f .gitattributes ] || { echo "STALE       $1  <-- .gitattributes missing"; stale=$((stale+1)); return; }
  cp .gitattributes .attrs.bak
  python3 -c "
import sys,io
s=open('.gitattributes',encoding='utf-8').read()
old,new='''$2''','''$3'''
assert old in s, 'MUTATION TARGET NOT FOUND: $1'
open('.gitattributes','w',encoding='utf-8',newline='').write(s.replace(old,new,1))"
  if [ $? -ne 0 ]; then mv .attrs.bak .gitattributes; echo "STALE       $1  <-- target missing, mutation tests nothing"; stale=$((stale+1)); return; fi
  if node reflux_checks.cjs "$SRC" >/dev/null 2>&1; then echo "NOT CAUGHT  $1  <-- checker gap"; fail=$((fail+1));
  else echo "caught      $1"; pass=$((pass+1)); fi
  mv .attrs.bak .gitattributes
}
runcrlf(){ # name -- rewrites SRC with CRLF endings, which must be rejected
  python3 -c "
s=open('$SRC',encoding='utf-8',newline='').read()
assert '\r\n' not in s, 'SOURCE ALREADY CRLF: $1'
open('mut.html','w',encoding='utf-8',newline='').write(s.replace('\n','\r\n'))"
  if [ $? -ne 0 ]; then echo "STALE       $1  <-- could not build a CRLF copy"; stale=$((stale+1)); return; fi
  if node reflux_checks.cjs mut.html >/dev/null 2>&1; then echo "NOT CAUGHT  $1  <-- checker gap"; fail=$((fail+1));
  else echo "caught      $1"; pass=$((pass+1)); fi
}
# --- static checker mutations ---
run "employer string reintroduced" "Gary Chan" "Gary Chan, KSC" reflux_checks.cjs
run "profiler CSS unscoped" "#panel-ipcal .sample-card {" ".sample-card {" reflux_checks.cjs
run "colliding var leaks to root" "#panel-ipcal {\n      --bg:" ":root {\n      --bg:" reflux_checks.cjs
run "tab added to bar but not TABS" "switchTab('ipcal')\">Impurity Profile</button>" "switchTab('ipcal')\">Impurity Profile</button><button class=\"tab-btn\" onclick=\"switchTab('bogus')\">X</button>" reflux_checks.cjs
run "second theme key reintroduced" "reflux-theme\",next" "ipcal-theme\",next" reflux_checks.cjs
run "IIFE opened around profiler removed" "(function () {
  'use strict';" "'use strict';" reflux_checks.cjs
run "syntax error injected" "function switchTab(id){" "function switchTab(id){{" reflux_checks.cjs
run "duplicate element id" "id=\"runBtn\"" "id=\"fileInput\"" reflux_checks.cjs
run "old contact address restored" "CONTACT=\"jeuron@gmail.com\"" "CONTACT=\"gary.chan@kaneka.sg\"" reflux_checks.cjs
echo "--- structure editor: static ---"
run "structure-editor CSS unscoped" "#panel-chem .chem-bar {" ".chem-bar {" reflux_checks.cjs
run "structure-editor var collides with shell" "--chem-chip: var(--bg-input);" "--bg: var(--bg-input);" reflux_checks.cjs
run "employer string back on the structure-editor tab" "switchTab('chem')\">Structure Editor</button>" "switchTab('chem')\">KSC Structure Editor</button>" reflux_checks.cjs
run "structure-editor IIFE signature broken" "<script id=\"chem-app\">\n(function(){" "<script id=\"chem-app\">\n(async function(){" reflux_checks.cjs
run "header version drifts from the rendered version" "APP_VER=\"v3\"" "APP_VER=\"v2\"" reflux_checks.cjs
run "branded global reinstated" "window.refluxChem = {" "window.kscChemSketch = {" reflux_checks.cjs
run "vendored engine payload altered" "<style id=\"chem-theme-css\">" "<style id=\"chem-theme-css\">/*x*/" reflux_checks.cjs
run "dead colour-swatch rule reintroduced" "span.K-StyleSheet-Detector{" ".K-Res-Icon-Color-NotSet{color:red}span.K-StyleSheet-Detector{" reflux_checks.cjs
run "engine sheet scope exemption widened" "#panel-chem .K-Chem-Composer{" ".K-Chem-Composer{" reflux_checks.cjs
echo "--- behavioural ---"
run "wide-layout toggle dropped" "document.body.classList.toggle(\"wide\",id===\"ipcal\"||id===\"chem\");" "" reflux_behave.cjs
run "panel not registered active" "document.getElementById(\"panel-\"+id).classList.add(\"active\");" "" reflux_behave.cjs
run "theme default flipped to dark" "data-theme=\"light\">" "data-theme=\"dark\">" reflux_behave.cjs
run "structure-editor tab dropped from the bar" "<button class=\"tab-btn\" onclick=\"switchTab('chem')\">Structure Editor</button>" "" reflux_behave.cjs
run "missing-engine guard removed" "if (typeof Kekule === 'undefined' ||" "if (false \&\& typeof Kekule === 'undefined' ||" reflux_behave.cjs
run "static UI no longer built at load" "    buildElementPicker();\n    buildTemplateButtons();" "    buildElementPicker();" reflux_behave.cjs
run "activation no longer boots the editor" "if (panel.classList.contains('active')){ obs.disconnect(); bootEditor(); }" "if (false){ obs.disconnect(); bootEditor(); }" reflux_behave.cjs
echo "--- deep links and splash page ---"
run "hash no longer validated against TABS" "TABS.indexOf(h)>=0?h:null" "h||null" reflux_behave.cjs
run "hashchange listener dropped" "window.addEventListener(\"hashchange\",applyHashTab);" "" reflux_behave.cjs
run "tab switch stops updating the hash" "try{history.replaceState(null,\"\",\"#\"+id);}catch(e){}" "" reflux_behave.cjs
runsplash "splash link points at a tab that does not exist" "href=\"reflux.html#chem\">" "href=\"reflux.html#chemistry\">"
runsplash "splash card loses its deep link" "href=\"reflux.html#ipcal\">" "href=\"reflux.html\">"
echo "--- checkout hygiene ---"
runattrs "LF pin dropped from .gitattributes" "* text=auto eol=lf" ""
runattrs "checkout pinned back to CRLF" "eol=lf" "eol=crlf"
runcrlf  "source checked out with CRLF endings"
echo "--- responsive layout ---"
run "tab buttons drop below a 44px touch target" ".tab-btn{min-height:44px;}" ".tab-btn{min-height:24px;}" reflux_checks.cjs
run "theme toggle reverts to a 18x32 target" ".theme-toggle{min-width:44px;min-height:44px;" ".theme-toggle{min-width:18px;min-height:32px;" reflux_checks.cjs
run "inputs lose their touch sizing" ".field input,.field select,.field .title-input{min-height:44px;}" "" reflux_checks.cjs
run "footer link loses its touch sizing" ".footer a{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;}" ".footer a{display:inline-flex;align-items:center;padding:0 4px;}" reflux_checks.cjs
run "tablet breakpoint removed" "@media(max-width:900px){.content{padding:16px;}.tab-bar{padding:0 12px;}.tab-btn{padding:12px 14px;}}" "" reflux_checks.cjs
run "field cap lifted so inputs balloon again" "max-width:240px" "max-width:none" reflux_checks.cjs
run "free-text fields lose their opt-out from the cap" ".field:has(.eq-input),.field:has(.title-input){max-width:none;}" "" reflux_checks.cjs
run "active tab no longer scrolled into view" "if(ab.scrollIntoView)try{ab.scrollIntoView({block:\"nearest\",inline:\"center\"});}catch(e){}" "" reflux_checks.cjs
runsplash "splash loses its touch-pointer block" "@media(pointer:coarse)" "@media(pointer:fine)"
echo "--- Lab Book design system ---"
run "body typeface reverts to IBM Plex" "--font-body:\"Source Sans 3\"," "--font-body:\"IBM Plex Sans\"," reflux_checks.cjs
run "mono ligatures switched back on" "min-height:100vh;font-variant-ligatures:none;" "min-height:100vh;" reflux_checks.cjs
runsplash "splash palette drifts from the toolbox" "--accent:#1F6F8B;" "--accent:#3a6aee;"
echo "--- structure editor chips ---"
run "element chips lose their panel classes" "b.className = 'chem-chip chem-el';" "b.className = 'chip el';" reflux_checks.cjs
run "template chips lose their panel class" "b.className = 'chem-chip';" "b.className = 'chip';" reflux_behave.cjs
runsplash "splash loses its tablet breakpoint" "@media(max-width:900px){.content{padding:24px 16px 32px;}}" ""
# The point of reflux_view.cjs: reflux_checks.cjs asserts that a rule was written, so a
# defect that leaves every rule intact and breaks only the rendered result is
# invisible to it. Neither of these two turns the static checker red.
echo "--- rendered layout (browser) ---"
run "content forced wider than a phone viewport" ".content{padding:24px;max-width:960px;" ".content{padding:24px;min-width:1200px;max-width:960px;" reflux_view.cjs
runsplash "splash footer link loses its touch sizing" ".footer a{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;}" ".footer a{padding:0 4px;}" reflux_view.cjs
# Dropping the call leaves every definition in place, so the static checker sees
# nothing wrong: only a rendered zoom shows it never ran.
run "editor zoom fit never invoked" "      fitZoomWhenSettled();" "" reflux_view.cjs
run "editor zoom clamp pinned to the engine default" "Math.max(0.6, Math.min(1.5," "Math.max(1.5, Math.min(1.5," reflux_checks.cjs
echo "--- end-to-end arithmetic ---"
run "RRT inverted" "var rrt = cp.rt / refPeak.rt;" "var rrt = refPeak.rt / cp.rt;" reflux_e2e.cjs
run "v4 Area% fix reverted (negatives back in denominator)" "cp.corrected > 0 ? cp.corrected : 0" "cp.corrected" reflux_e2e.cjs
run "empty-canvas export guard removed" "  function emptyGuard(){\n    if (engineGuard()) return true;" "  function emptyGuard(){\n    if (false) return true;" reflux_e2e.cjs
# Results describe one file set in one order. Removing or reordering a sample
# used to leave them standing while the exports read their headers from the
# live list, filing every number under the wrong sample name.
echo "--- results outliving their file set ---"
run "file-set change no longer invalidates results" "    invalidateResults();\n    renderFileCards();" "    renderFileCards();" reflux_e2e.cjs
# Hiding the panel without dropping the state leaves the export buttons live,
# so this checks the state clear and not merely the DOM change.
run "invalidation hides the panel but keeps the stale state" "    lastGroups = null; lastSettings = null; lastRefWarnings = []; lastSampleList = null;" "    lastRefWarnings = [];" reflux_e2e.cjs
# The exports read the sample list captured at calculation time. Reverting them
# to the live list is invisible while the invalidation above holds, so what is
# testable is that the capture is real and load-bearing.
run "calculation stops capturing its sample list" "    lastSampleList = sampleList;" "    lastSampleList = null;" reflux_e2e.cjs
# Variable names are substituted in one pass over whole identifiers. Matching
# anything narrower puts a name back inside sqrt, min, abs and exp.
echo "--- equation builder substitution ---"
run "substitution stops matching whole identifiers" "/[A-Za-z_][A-Za-z_0-9]*/g" "/[A-Za-z_]/g" reflux_behave.cjs
run "variable lookup becomes case-sensitive" "byLower[id.toLowerCase()]" "byLower[id]" reflux_behave.cjs
run "bare x stops meaning multiply" "'*'),scope:safeScope}" "'+'),scope:safeScope}" reflux_behave.cjs
echo "--- user text escaped, not interpolated ---"
run "escape helper stops escaping angle brackets and quotes" ".replace(/[&<>\"']/g,c=>(" ".replace(/[&]/g,c=>(" reflux_behave.cjs
run "reagent name written unescaped into its field" "value=\"'+esc(r.name)+'\"" "value=\"'+r.name+'\"" reflux_behave.cjs
# wt% is a mass basis and g/L a volume basis; density is the bridge between
# them. Dropping it silently assumes every solvent weighs 1 g/mL.
echo "--- dynamic row ids ---"
# Reverting to a timestamp reproduces the original collision exactly: two rows
# built in one tick share an id, so edits land on the wrong row and a single
# remove deletes both.
run "row ids revert to a timestamp and collide" "function nextId(){return ++rowSeq;}" "function nextId(){return Date.now();}" reflux_behave.cjs
run "row ids revert to the timestamp-plus-random scheme" "function nextId(){return ++rowSeq;}" "function nextId(){return Date.now()+Math.round(Math.random());}" reflux_behave.cjs
echo "--- wt% carries the solution density ---"
run "wt% to g/L drops the density" "case'wt%':g=val*10*dens;break;}" "case'wt%':g=val*10;break;}" reflux_behave.cjs
run "g/L to wt% drops the density" "case'wt%':result=g/(10*dens);break;}" "case'wt%':result=g/10;break;}" reflux_behave.cjs
echo
echo "caught $pass, missed $fail, stale $stale"
rm -f mut.html
[ $fail -eq 0 ] && [ $stale -eq 0 ]
