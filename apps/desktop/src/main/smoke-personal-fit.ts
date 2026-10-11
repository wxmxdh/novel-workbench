import type { BrowserWindow } from "electron";

/** Real preload/Core/UI check restricted by the caller to a disposable fictional workspace. */
export async function runPersonalFitSmoke(
  window: BrowserWindow,
  projectId: string
) {
  return window.webContents.executeJavaScript(
    `(async(projectId)=>{
    const api=window.deepwrite.otter;
    const ensure=(value,message)=>{if(!value)throw new Error(message)};
    const wait=async(select,message)=>{const end=Date.now()+10000;let value;while(!(value=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(value,message);return value};
    const view=await api.open({projectId});
    const original=view.documents.find(item=>item.category==='draft');ensure(original,'Fictional source draft missing');
    const before=await api.read({projectId,path:original.path});
    const base={projectId,title:'Isolated author candidate',kind:'draft',volume:'第一卷',chapter:1,version:'初稿',content:'Fictional candidate only. No real story data.'};
    const a=await api.saveWriting({...base,model:'fixture-model-a'});
    const b=await api.saveWriting({...base,model:'fixture-model-b'});
    const revision=await api.saveWriting({...base,model:'fixture-model-a',version:'修订01',revisionOf:a.path,content:'Separate fictional revision.'});
    ensure(new Set([a.path,b.path,revision.path]).size===3,'Versions overwritten');
    ensure([a,b,revision].every(item=>item.status==='author-candidate'&&item.path.startsWith('.novel/notes/writing/')),'Candidate destination/status wrong');
    const after=await api.read({projectId,path:original.path});ensure(before.hash===after.hash,'Original draft changed');
    const refreshed=await api.open({projectId});
    ensure([a.path,b.path,revision.path].every(path=>refreshed.documents.some(item=>item.path===path&&item.category==='draft'&&item.status==='candidate')),'Candidate not browsable with candidate identity');
    const context=await api.prepareDiscussion({projectId,topic:'Discuss fictional candidate only; do not write a chapter.',sources:[a.path],skills:['otter-novel','scene-craft']});
    const pack=JSON.parse((await api.read({projectId,path:context.contextPath})).content);
    const receipt=JSON.parse((await api.read({projectId,path:context.receiptPath})).content);
    ensure(pack.skills_allowed.includes('scene-craft'),'Optional method missing from Context');
    ensure(receipt.read_sources.some(item=>item.path==='workspace:.agents/skills/scene-craft/SKILL.md'&&item.bytes_emitted>0),'Optional method was not actually read');
    ensure(pack.sources.some(item=>item.path===a.path&&item.authority==='task'&&item.purpose.includes('候选稿')&&item.content.includes('status: author-candidate')),'Candidate boundary lost in real V1 Context');
    let invalid='';try{await api.saveWriting({...base,model:'unknown',outline:'../outside.md'})}catch(error){invalid=String(error)}ensure(invalid,'Traversal reference accepted');
    const manuscriptMenu=await wait(()=>document.querySelector('.conversation-pane button[aria-label="稿件"]'),'Manuscript menu missing');manuscriptMenu.click();
    const newButton=await wait(()=>[...document.querySelectorAll('button,[role=option]')].find(item=>item.textContent?.trim()==='新建稿件'),'New manuscript control missing');newButton.click();
    const dialog=await wait(()=>document.querySelector('.writing-candidate-dialog'),'Candidate dialog failed to load');
    ensure(dialog.textContent.includes('原稿保持原样'),'Candidate boundary not visible');
    const fill=(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}))};
    const inputs=dialog.querySelectorAll('input');ensure(inputs.length===5,'Unexpected candidate fields');
    fill(inputs[0],'Fictional UI outline');fill(inputs[1],'第一卷');fill(inputs[2],'2');fill(inputs[3],'unknown');fill(inputs[4],'初稿');fill(dialog.querySelector('textarea'),'Fictional UI candidate.');
    dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await wait(()=>!document.querySelector('.writing-candidate-dialog'),'Candidate UI save did not finish');
    const finalView=await api.open({projectId});ensure(finalView.documents.some(item=>item.title==='Fictional UI outline'),'UI saved candidate not listed');
    const resources=await wait(()=>[...document.querySelectorAll('.conversation-pane button')].find(item=>item.textContent?.includes('资料与方法')),'Resources/method control missing');resources.click();
    const picker=await wait(()=>document.querySelector('.method-picker'),'Method picker failed to load');
    ensure(picker.querySelectorAll('input[type=checkbox]').length>=6,'Shared methods not offered');
    document.querySelector('.novel-source-popover header button').click();
    document.querySelector('[data-nav-id="agent-teams"]').click();
    const recommendationButton=await wait(()=>document.querySelector('.team-recommendations-trigger'),'Team recommendations missing');recommendationButton.click();
    const recommendations=await wait(()=>document.querySelector('.team-recommendations-dialog'),'Recommendation dialog missing');
    ensure(recommendations.querySelectorAll('.team-recommendation-card').length>=5,'Professional team presets missing');
    ensure(recommendations.textContent.includes('不会'),'Recommendation boundary not visible');
    const teamsBefore=await window.deepwrite.agentTeams.list();
    const combined=recommendations.querySelector('.team-combined-recommendation-card .apply-recommendation-button');
    ensure(combined&&!combined.disabled,'Combined one-click team control missing');combined.click();
    let savedCombined;let teamsAfter;const teamDeadline=Date.now()+10000;
    while(Date.now()<teamDeadline){teamsAfter=await window.deepwrite.agentTeams.list();savedCombined=teamsAfter.teams.find(item=>!teamsBefore.teams.some(old=>old.id===item.id)&&item.workspaceType==='long'&&item.settings.teams.find(parent=>parent.parentAgentId==='long')?.subagents.length===5);if(savedCombined)break;await new Promise(r=>setTimeout(r,80));}
    ensure(savedCombined,'One-click combined team did not persist five members');
    ensure(JSON.stringify(teamsBefore.enabledTeamIds)===JSON.stringify(teamsAfter.enabledTeamIds),'One-click preset silently changed active teams');
    recommendations.querySelector('.team-recommendations-close').click();
    const card=await wait(()=>document.querySelector('.team-card-main'),'Original team catalogue missing');card.click();
    const navigation=await wait(()=>document.querySelector('.detail-navigation'),'Original team editor missing');
    const panel=await wait(()=>document.querySelector('.agent-team-settings'),'Original team settings missing');
    const alignment=Math.abs(navigation.getBoundingClientRect().left-panel.getBoundingClientRect().left);
    ensure(alignment<=1,'Team navigation and settings are misaligned: '+alignment);
    navigation.querySelector('.back-button').click();
    document.querySelector('[data-nav-id="otter-workbench"]').click();
    await wait(()=>document.querySelector('.conversation-pane'),'Novel workspace did not restore after team review');
    return {separateModelCandidates:true,revisionPreservesOriginal:true,originalDraftHash:before.hash,candidateAuthorityInV1:true,optionalSkillActuallyRead:true,invalidReferenceRejected:true,manualCandidateUi:true,methodPickerVisible:true,teamRecommendationsVisible:true,oneClickCombinedTeamSaved:true,combinedMemberCount:5,activeTeamsUnchanged:true,teamHeaderAlignmentPixels:alignment};
  })(${JSON.stringify(projectId)})`,
    true
  );
}
