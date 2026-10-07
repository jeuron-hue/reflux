const fs=require('fs'), {JSDOM}=require('jsdom');
let fails=[];
const chk=(c,m)=>{console.log((c?'PASS  ':'FAIL  ')+m); if(!c)fails.push(m);};

let html=fs.readFileSync(process.argv[2]||'reflux.html','utf8');
// strip CDN tags; stub the three libs so the page can boot offline
html=html.replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
// strip the vendored structure-editor engine for the same reason: it is 2.7MB
// of third-party code this suite does not test, and its composer needs a real
// canvas. Removing it also exercises the panel's engine-absent path.
html=html.replace(/<script id="chem-lib-[a-z]+">[\s\S]*?<\/script>/g,'');
html=html.replace(/<style id="chem-theme-css">[\s\S]*?<\/style>/g,'');
const errs=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://localhost/',
  beforeParse(w){
    w.ExcelJS={}; w.XLSX={utils:{},writeFile(){}};
    // Math is layered under the scope so the stub answers to sqrt/min/abs/log
    // /exp. The substitution defect showed up only against real function names:
    // a variable named q used to be rewritten inside sqrt.
    w.math={evaluate:(e,s)=>Function('s','with(Math){with(s){return '+e+'}}')(s||{})};
    w.onerror=(m)=>errs.push(String(m));
    w.addEventListener('error',e=>errs.push(String(e.message)));
  }});
const {window}=dom, d=window.document;

chk(errs.length===0,'no uncaught errors on load ('+errs.slice(0,2)+')');

// panels
const panels=[...d.querySelectorAll('.calc-panel')].map(p=>p.id);
chk(panels.length===8,'8 panels present (got '+panels.length+')');
chk(panels.includes('panel-ipcal'),'impurity profile panel present');
chk(panels.includes('panel-chem'),'structure editor panel present');
chk(d.querySelectorAll('.calc-panel.active').length===1,'exactly one panel active on load');
chk(d.getElementById('panel-charge').classList.contains('active'),'charge tab active on load');

// header / footer strings
chk(d.getElementById('app-title').textContent.includes('Reflux'),'title renders Reflux');
chk(d.getElementById('app-sub').textContent.trim()==='\u00a9 Gary Chan','header sub is bare copyright');
chk(d.getElementById('footer-bug').href.includes('jeuron@gmail.com'),'footer bug link retargeted');
chk(d.getElementById('bugReport').href.includes('jeuron@gmail.com'),'profiler bug link retargeted');
chk(!d.body.innerHTML.match(/kaneka/i),'no employer string in rendered body');
chk(!d.body.innerHTML.match(/KSC/i),'no employer initials in rendered body');
chk(!d.body.innerHTML.match(/ChemSketch/i),'no prior product name in rendered body');
chk(!d.body.textContent.match(/kaneka|KSC|ChemSketch/i),'no employer or prior product string in rendered text');

// tab switching, both directions
window.switchTab('ipcal');
chk(d.getElementById('panel-ipcal').classList.contains('active'),'switch to ipcal activates panel');
chk(d.querySelectorAll('.calc-panel.active').length===1,'still exactly one active after switch');
chk(d.body.classList.contains('wide'),'wide layout applied on ipcal tab');
chk([...d.querySelectorAll('.tab-btn')].filter(b=>b.classList.contains('active')).length===1,'one tab button active');
chk(d.querySelectorAll('.tab-btn')[6].classList.contains('active'),'7th tab button is the active one');
window.switchTab('units');
chk(!d.body.classList.contains('wide'),'wide layout removed leaving ipcal tab');
chk(d.getElementById('panel-units').classList.contains('active'),'switch back works');

// profiler booted: renderAll() populated its containers
chk(d.getElementById('fileCount').textContent.length>0,'profiler renderAll ran (file count rendered)');
chk(d.getElementById('resultsSection').hasAttribute('hidden'),'results hidden before any run');

// theme engine: one toggle drives every panel
const root=d.documentElement;
chk(root.getAttribute('data-theme')==='light','light default');
window.toggleTheme();
chk(root.getAttribute('data-theme')==='dark','toggle -> dark');
chk(window.localStorage.getItem('reflux-theme')==='dark','persisted under reflux-theme');
chk(window.localStorage.getItem('ipcal-theme')===null,'no second theme key written');
chk(window.localStorage.getItem('chem-theme')===null,'no third theme key written');
window.toggleTheme();
chk(root.getAttribute('data-theme')==='light','toggle -> light');

// calculator still computes (charge amount, wt/wt)
const set=(id,v)=>{const e=d.getElementById(id); if(e){e.value=v; e.dispatchEvent(new window.Event('input',{bubbles:true}));} return !!e;};
chk(typeof window.calcCharge==='function','calcCharge exposed');
chk(typeof window.evalEquations==='function','evalEquations exposed');
chk(typeof window.calcUnits==='function','calcUnits exposed');

// The calculator panels keep their state in let-scoped globals, which are not
// window properties, so reach them the way the page itself would.
const ev=(code)=>window.eval(code);

// ---- equation builder: whole-identifier substitution ----------------------
// Names used to be substituted with one unanchored global regex each, so a name
// matched inside longer identifiers and inside the tokens the pass had already
// written. Single-letter names are the natural case in a chemistry tool and
// every one of them collided with some function.
const runEq=(vars,expr)=>{
  ev('eqVars.length=0;eqEqs.length=0;');
  ev('eqVars.push.apply(eqVars,'+JSON.stringify(vars.map(([n,val],i)=>({id:i+1,name:n,value:String(val)})))+');'
    +'eqEqs.push('+JSON.stringify({id:99,name:'',expr})+');');
  window.evalEquations();
  return d.querySelector('#eq-results .result-value').textContent.trim();
};
chk(runEq([['q',16]],'sqrt(q)')==='4','variable q survives sqrt(q) (got "'+runEq([['q',16]],'sqrt(q)')+'")');
chk(runEq([['t',9]],'sqrt(t)')==='3','variable t survives sqrt(t)');
chk(runEq([['n',2]],'min(n, 5)')==='2','variable n survives min(n, 5)');
chk(runEq([['a',-3]],'abs(a)')==='3','variable a survives abs(a)');
chk(runEq([['e',0]],'exp(e)')==='1','variable e survives exp(e)');
// __v0 contains a v, so a variable named v used to rewrite its own tokens.
chk(runEq([['mass',10],['v',2]],'mass / v')==='5','a variable named v does not corrupt the substitution tokens');
chk(runEq([['area',3],['v',4]],'area * v')==='12','v still resolves alongside a longer name');
// Behaviour that must survive the rewrite.
chk(runEq([['mw',100]],'MW * 2')==='200','lookup stays case-insensitive');
chk(runEq([['mass',4]],'mass x 2')==='8','an undefined x still means multiply');
chk(runEq([['x',5]],'x + 1')==='6','a defined x is a variable, not multiplication');
chk(runEq([['mass',2]],'1e3 * mass')==='2000','scientific notation is left alone');

// ---- user text is escaped, never interpolated ----------------------------
// These panels build markup as strings, so a quote or an angle bracket in any
// name field used to break out of the attribute it was written into.
const inject='"><img src=x onerror=alert(1)>';
ev('chReagents.length=0;');window.addChReagent();
const rid=ev('chReagents[0].id');
window.updCR(rid,'name',inject);
window.updCR(rid,'ratioType','wt/wt');
chk(d.querySelectorAll('#ch-reagents img').length===0,'reagent name escaped in the form');
chk(d.querySelector('#ch-reagents input[type=text]').value===inject,'reagent name round-trips through the escape unchanged');
set('ch-basis-wt','100');window.updCR(rid,'ratio','1');window.calcCharge();
chk(d.querySelectorAll('#ch-results img').length===0,'reagent name escaped in the results');
chk(d.getElementById('ch-results').textContent.includes('<img'),'the results show the name as text');

ev('ymbSteps.length=0;');window.addYmbStep();
window.updYmb(ev('ymbSteps[0].id'),'title',inject);window.renderYmb();
chk(d.querySelectorAll('#ymb-steps img').length===0,'block title escaped');
chk(d.querySelector('#ymb-steps .title-input').value===inject,'block title round-trips unchanged');

runEq([['<img src=y onerror=alert(2)>',1]],'1+1');
chk(d.querySelectorAll('#eq-variables img, #eq-equations img, #eq-results img').length===0,'variable name escaped in the scope pill and results');
const exprInject='<img src=z onerror=alert(3)>';
runEq([['mass',1]],exprInject);
chk(d.querySelectorAll('#eq-equations img, #eq-results img').length===0,'equation expression escaped');
chk(d.querySelector('#eq-equations .eq-input').value===exprInject,'equation expression round-trips unchanged');

// ---- unit converter: wt% is a mass basis, so it needs the density --------
// wt% is grams per 100 g of solution; g/L is per litre. One litre weighs
// 1000*density grams, so density is the bridge. Assuming 1 g/mL silently
// understated every non-aqueous solvent, and Solution Prep already asks for it.
const conv=(from,to,val,dens)=>{
  d.getElementById('unit-cat').value='concentration';
  window.updateUnitOptions();
  d.getElementById('unit-value').value=String(val);
  d.getElementById('unit-density').value=String(dens);
  d.getElementById('unit-from').value=from;
  d.getElementById('unit-to').value=to;
  window.calcUnits();
  return d.querySelector('#unit-results .result-value').textContent.trim();
};
chk(!!d.getElementById('unit-density'),'unit converter exposes a solution density field');
chk(conv('wt%','g/L',1,1.0)==='10 g/L','1 wt% at 1.00 g/mL is 10 g/L (got "'+conv('wt%','g/L',1,1.0)+'")');
chk(conv('wt%','g/L',1,1.33)==='13.3 g/L','1 wt% in DCM at 1.33 g/mL is 13.3 g/L, not 10');
chk(conv('wt%','g/L',1,0.87)==='8.7 g/L','1 wt% in toluene at 0.87 g/mL is 8.7 g/L');
chk(conv('g/L','wt%',13.3,1.33)==='1 wt%','g/L back to wt% divides by the density');
chk(conv('g/L','mg/L',1,1.33)==='1000 mg/L','density does not touch the volume-basis units');

// ---- dynamic row ids survive same-tick creation --------------------------
// Rows were keyed on Date.now(), which collides whenever two are created inside
// one millisecond. The collision is not benign: the update helpers find the
// first match and so edit the wrong row, and the remove helpers filter by id
// and delete both. Every add below runs in a single tick, which is exactly the
// case the old scheme could not survive.
const idsOf=(arr)=>ev(arr+'.map(x=>x.id)');
ev('eqVars.length=0;');window.addEqVariable();window.addEqVariable();window.addEqVariable();
const vids=idsOf('eqVars');
chk(new Set(vids).size===3,'three variables added in one tick get distinct ids (got '+vids+')');
window.updEqVar(vids[1],'name','SECOND');
chk(ev('eqVars.map(v=>v.name).join(",")')===',SECOND,','naming the second variable edits only the second');
window.removeEqVar(vids[1]);
chk(ev('eqVars.length')===2,'removing one variable removes exactly one');

ev('chReagents.length=0;');window.addChReagent();window.addChReagent();
const cids=idsOf('chReagents');
chk(new Set(cids).size===2,'two reagents added in one tick get distinct ids');
window.updCR(cids[1],'name','SECOND');
chk(ev('chReagents.map(r=>r.name).join(",")')===',SECOND','naming the second reagent edits only the second');
window.removeChReagent(cids[0]);
chk(ev('chReagents.length')===1,'removing one reagent removes exactly one');

ev('ymbSteps.length=0;');window.addYmbStep();window.addYmbStep();
const sids=idsOf('ymbSteps');
chk(new Set(sids).size===2,'two blocks added in one tick get distinct ids');
ev('eqEqs.length=0;');window.addEqEquation();window.addEqEquation();
chk(new Set(idsOf('eqEqs')).size===2,'two equations added in one tick get distinct ids');
// Outputs draw on the same source, so their ids cannot collide with each other
// or be confused with the block ids they sit beside.
window.addOutput(sids[0]);window.addOutput(sids[0]);
const oids=ev('ymbSteps[0].outputs.map(o=>o.id)');
chk(new Set(oids).size===3,'three outputs on one block get distinct ids (got '+oids+')');
chk(oids.every(o=>!sids.includes(o)),'output ids do not collide with block ids');

// ---- structure editor -------------------------------------------------
// Its panel initialises on the load event, so everything below runs after a
// tick. The engine is stripped above, so this also proves the panel degrades
// to a message instead of throwing when the drawing engine is unavailable.
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
  await new Promise(r=>{ if(d.readyState==='complete') r(); else window.addEventListener('load',r); });
  await tick();

  chk(typeof window.refluxChem==='object','refluxChem hook exposed');
  chk(window.refluxChem.isReady()===false,'editor not constructed before the tab is opened');
  chk(d.querySelectorAll('#chem-elpick button').length===9,'9 element chips built without the engine');
  chk(d.querySelectorAll('#chem-templates button').length===10,'10 template buttons built without the engine');
  // Script-built chips must carry the panel's prefixed classes, or they match
  // no rule and render as bare browser buttons (the v2 rename missed them).
  chk([...d.querySelectorAll('#chem-elpick button')].every(b=>b.classList.contains('chem-chip')&&b.classList.contains('chem-el')),'element chips carry chem-chip and chem-el');
  chk([...d.querySelectorAll('#chem-templates button')].every(b=>b.classList.contains('chem-chip')),'template chips carry chem-chip');
  chk(d.getElementById('chem-composer-host').children.length===0,'composer host still empty before activation');
  chk(d.querySelectorAll('#panel-chem [onclick]').length===0,'structure editor binds no inline handlers');

  window.switchTab('chem');
  chk(d.getElementById('panel-chem').classList.contains('active'),'switch to chem activates panel');
  chk(d.body.classList.contains('wide'),'wide layout applied on chem tab');
  chk(d.querySelectorAll('.tab-btn')[7].classList.contains('active'),'8th tab button is the active one');

  await tick();   // MutationObserver -> bootEditor
  const st=d.getElementById('chem-status');
  chk(/did not load/i.test(st.textContent),'engine absent -> panel degrades to a message ("'+st.textContent.slice(0,44)+'")');
  chk(st.className==='warn','degraded status carries the warn class');
  chk(window.refluxChem.isReady()===false,'editor still reports not ready without the engine');
  let threw=false;
  try{ d.querySelectorAll('#chem-templates button')[0].click();
       d.getElementById('chem-btn-png').click();
       d.getElementById('chem-btn-copy').click(); }catch(e){ threw=true; }
  chk(!threw,'template and export buttons are inert, not throwing, without the engine');
  chk(errs.length===0,'still no uncaught errors after driving the degraded panel ('+errs.slice(0,2)+')');

  window.switchTab('units');
  chk(!d.body.classList.contains('wide'),'wide layout removed leaving the chem tab');

  // ---- deep links -------------------------------------------------------
  // index.html points at one tool with reflux.html#<tab>. Both the live
  // hashchange path and the load-time path have to resolve, and an unknown
  // hash has to fall back rather than reach getElementById("panel-<junk>").
  chk(window.location.hash==='#units','switching a tab writes the hash (got "'+window.location.hash+'")');
  window.location.hash='#ipcal';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  chk(d.getElementById('panel-ipcal').classList.contains('active'),'hashchange to #ipcal switches tab');
  window.location.hash='#nosuchtab';
  let hashThrew=false;
  try{ window.dispatchEvent(new window.HashChangeEvent('hashchange')); }catch(e){ hashThrew=true; }
  chk(!hashThrew,'unknown hash does not throw');
  chk(d.getElementById('panel-ipcal').classList.contains('active'),'unknown hash leaves the current tab alone');

  const boot=(hash)=>{
    const dd=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://localhost/'+hash,
      beforeParse(w){w.ExcelJS={};w.XLSX={utils:{},writeFile(){}};w.math={evaluate:()=>0};}});
    return dd.window.document;
  };
  chk(boot('#ipcal').getElementById('panel-ipcal').classList.contains('active'),'deep link #ipcal opens that tab on load');
  chk(boot('#chem').getElementById('panel-chem').classList.contains('active'),'deep link #chem opens that tab on load');
  chk(boot('#nosuchtab').getElementById('panel-charge').classList.contains('active'),'unknown hash on load falls back to the default tab');
  chk(boot('').getElementById('panel-charge').classList.contains('active'),'no hash on load opens the default tab');

  console.log('\n'+(fails.length?fails.length+' FAILURES':'ALL GREEN'));
  process.exit(fails.length?1:0);
})();
