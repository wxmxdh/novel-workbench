import { app, type BrowserWindow } from "electron";
import { resolve } from "node:path";

/** Exercises public IPC and real Vue controls only in an explicit disposable profile. */
export async function runReviewSkillsSmoke(window: BrowserWindow) {
  const fixture = process.env.DEEPWRITE_REVIEW_SKILLS_SMOKE_ROOT;
  if (
    process.env.DEEPWRITE_SMOKE !== "1" ||
    !fixture ||
    resolve(fixture) !== resolve(app.getPath("userData"))
  )
    throw new Error(
      "Review skills smoke requires its explicit disposable profile."
    );
  return window.webContents.executeJavaScript(`(async () => {
    const ensure = (value, message) => { if (!value) throw new Error(message); };
    const wait = async (get, message) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { const value = get(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
      throw new Error(message);
    };
    const api = window.deepwrite.agentTeams;
    ensure(typeof api.saveReviewSkills === 'function', 'Review settings API missing');
    const initial = await api.list();
    const nativeIndex = await window.deepwrite.catalog.index();
    const nativeLibrary = nativeIndex.skills.find(library => library.title === '中文表达审核');
    ensure(nativeLibrary && nativeLibrary.entries.length === 1, 'Native skill library is not visible or does not contain exactly one entry');
    const nativeEntry = await window.deepwrite.catalog.readDocument({ projectId:nativeLibrary.id, target:'document', documentId:nativeLibrary.entries[0].id });
    ensure(nativeEntry.title === '说人话' && nativeEntry.content.includes('codex-installed-review-skill:shuorenhua:v1') && nativeEntry.content.includes('# 说人话') && nativeEntry.content.includes('source-skill-sha256: 56a156045d2ac25ebf8210768b6c2608a42c37ac7ee4979d746cde7b026012db') && nativeEntry.content.includes('references/editing-guide.md') && nativeEntry.content.includes('references/examples.md'), 'Native Shuorenhua entry content or pinned source hash is missing');
    const previous = initial.teams.find(t => t.name === 'Review skill smoke team');
    const previousReviewer = previous?.settings.teams.flatMap(t => t.subagents).find(s => s.id === 'reviewer');
    if (previous) {
      ensure(initial.reviewSkills?.enabledIds.join(',') === 'shuorenhua', 'Global defaults did not persist after reopening');
      ensure(previousReviewer?.reviewSkillIds?.join(',') === 'sepia', 'Member override did not persist');
    }
    (await wait(() => document.querySelector('[data-nav-id="agent-teams"]'), 'Team navigation did not mount')).click();
    const panel = await wait(() => document.querySelector('.global-review-skills'), 'Global review controls did not mount');
    let checks = panel.querySelectorAll('input[type=checkbox]');
    ensure(checks.length === 4 && checks[0].checked && [...checks].slice(1).every(c => !c.checked), 'Only Shuorenhua must default to enabled');
    checks[1].click();
    await new Promise(r => setTimeout(r, 30));
    panel.querySelector('button').click();
    let saved;
    const globalSaveDeadline = Date.now() + 15000;
    while (Date.now() < globalSaveDeadline) {
      saved = await api.list();
      if (saved.reviewSkills?.enabledIds.join(',') === 'shuorenhua,humanizer-zh') break;
      await new Promise(r => setTimeout(r, 50));
    }
    ensure(saved.reviewSkills?.enabledIds.join(',') === 'shuorenhua,humanizer-zh', 'Explicit archived-skill selection did not round-trip through IPC');
    let invalid = false;
    try { await api.saveReviewSkills({ enabledIds: ['unknown'] }); } catch { invalid = true; }
    ensure(invalid, 'Unknown skill accepted by preload');
    let team = previous;
    if (!team) {
      const created = await api.create({ workspaceType: 'long', name: 'Review skill smoke team' });
      team = created.teams.find(t => t.name === 'Review skill smoke team');
      const settings = structuredClone(team.settings);
      settings.teams[0].subagents.push({ id:'reviewer', name:'Smoke Reviewer', description:'Review only', systemPrompt:'Review supplied fiction', enabled:true, modelMode:'inherit' });
      await api.save({ teamId:team.id, settings });
    }
    // Reload to hydrate the catalog through ordinary application state.
    return { status:'ok', reopened:!!previous, teamId:team.id, globalRoundTrip:true, invalidRejected:true };
  })()`);
}

export async function runReviewSkillMemberSmoke(
  window: BrowserWindow,
  teamId: string
) {
  // Only a controlled ID returned by the API is interpolated, using a JSON literal.
  if (!/^team_[a-zA-Z0-9_-]+$/u.test(teamId))
    throw new Error("Invalid fixture team ID");
  const loaded = new Promise<void>((done) =>
    window.webContents.once("did-finish-load", () => done())
  );
  window.webContents.reload();
  await loaded;
  return window.webContents.executeJavaScript(`(async (teamId) => {
    const ensure = (value, message) => { if (!value) throw new Error(message); };
    const wait = async (get, message) => {
      const deadline = Date.now()+15000;
      while(Date.now()<deadline){ const found=get(); if(found)return found; await new Promise(r=>setTimeout(r,50)); }
      throw new Error(message);
    };
    (await wait(() => document.querySelector('[data-nav-id="agent-teams"]'), 'Team navigation did not mount after reload')).click();
    const card = await wait(() => [...document.querySelectorAll('.team-card')].find(c => c.textContent.includes('Review skill smoke team')), 'Fixture team not rendered');
    card.querySelector('.team-card-main').click();
    const edit = await wait(() => document.querySelector('.subagent-card button[aria-label*="Smoke Reviewer"]'), 'Member edit button missing');
    edit.click();
    const selector = await wait(() => document.querySelector('.subagent-form .review-skill-selector'), 'Member skill controls missing');
    const inherit = selector.querySelector('.inherit-option input');
    if (inherit.checked) inherit.click();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const checks = selector.querySelectorAll('.skill-options input');
    ensure(checks.length === 4, 'Member skill checklist missing');
    for (let i=0;i<4;i++) {
      const shouldBeChecked = i === 3;
      if (checks[i].checked !== shouldBeChecked) checks[i].click();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      ensure(checks[i].checked === shouldBeChecked, 'Member skill checkbox did not settle after update');
    }
    ensure([...checks].map(c=>c.checked).join(',') === 'false,false,false,true', 'Member selector does not show only Sepia before save');
    const save = document.querySelector('.team-detail .panel-actions .primary-button');
    ensure(save, 'Team save button missing'); save.click();
    const api = window.deepwrite.agentTeams;
    let catalog;
    let member;
    const saveDeadline = Date.now()+15000;
    while(Date.now()<saveDeadline){
      catalog = await api.list();
      member = catalog.teams.find(t=>t.id===teamId)?.settings.teams.flatMap(t=>t.subagents).find(s=>s.id==='reviewer');
      if(member?.reviewSkillIds?.join(',') === 'sepia') break;
      await new Promise(r=>setTimeout(r,50));
    }
    ensure(member?.reviewSkillIds?.join(',') === 'sepia', 'Member selection was lost when saving; saved value: ' + (member?.reviewSkillIds?.join(',') ?? 'missing reviewer'));
    await api.saveReviewSkills({enabledIds:['shuorenhua']});
    return {status:'ok',memberRoundTrip:true,defaultRestored:true,nativeSkillVisible:true};
  })(${JSON.stringify(teamId)})`);
}
