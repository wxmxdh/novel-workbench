import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { BrowserWindow } from "electron";
import type { OtterDesktopService } from "../extras/otter/desktop-service";

/** Native test: real preload/Main/CLI, Agent utility and port-free author view. */
export async function runOtterSmoke(
  window: BrowserWindow,
  service: OtterDesktopService
) {
  const fixtureFile = process.env.DEEPWRITE_OTTER_SMOKE_FIXTURE;
  if (process.env.DEEPWRITE_SMOKE !== "1" || !fixtureFile)
    throw new Error("Otter smoke requires a disposable fixture.");
  const fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as {
    workspaceRoot: string;
    projectRoot: string;
    taskInput: Record<string, unknown>;
    screenshotPath: string;
  };
  if (service.requireWorkspace() !== resolve(fixture.workspaceRoot))
    throw new Error("Refusing smoke outside the supplied fixture workspace.");
  const result = (await window.webContents.executeJavaScript(
    `(async (fixture) => {
    const ensure = (value, reason) => { if (!value) throw new Error(reason); };
    const api = window.deepwrite;
    const navDeadline=Date.now()+8000;
    let navigation;
    while(!(navigation=document.querySelector('[data-nav-id="otter-workbench"]')) && !document.querySelector('[data-testid="otter-workbench"]') && Date.now()<navDeadline) await new Promise(resolve=>setTimeout(resolve,50));
    navigation?.click();
    const deadline=Date.now()+8000;
    while(!document.querySelector('[data-testid="otter-workbench"]') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    ensure(document.querySelector('[data-testid="otter-workbench"]'),'Novel workbench UI did not mount');
    const settings = await api.otter.settings();
    ensure(settings.workspaceRoot === fixture.workspaceRoot, 'Fixture workspace is not active');
    const projects = await api.otter.projects();
    const project = projects.find(item => item.hasProtocol);
    ensure(project, 'Fixture project not discovered');
    const select=document.querySelector('[data-testid="otter-project-select"]');
    (select?.querySelector('button')||select)?.click();
    const optionDeadline=Date.now()+5000;
    let option;
    while(!(option=[...document.querySelectorAll('[role="option"]')].find(item=>item.textContent.includes(project.title))) && Date.now()<optionDeadline)await new Promise(resolve=>setTimeout(resolve,50));
    ensure(option,'Project picker did not show fixture');option.click();
    const view = await api.otter.open({projectId:project.id});
    ensure(view.documents.length && view.documents.every(item=>item.readOnly), 'Readonly document mapping failed');
    const canon = view.documents.find(item=>item.category==='canon');
    const read = await api.otter.read({projectId:project.id,path:canon.path});
    ensure(read.content, 'Source read failed');
    const blocked = await api.otter.route({projectId:project.id,task:'draft',chapter:2,volume:'第一卷'});
    ensure(!blocked.result.allowed?.includes('draft'), 'Unplanned chapter was granted prose permission');
    const prepared = await api.otter.workflow({projectId:project.id,action:'prepare',input:fixture.taskInput});
    ensure(['PASS','WARN'].includes(prepared.result.status), 'Native V1 prepare/preflight failed: '+JSON.stringify(prepared));
    const relative = value => String(value).replaceAll('\\\\','/').slice(fixture.projectRoot.replaceAll('\\\\','/').length+1);
    const contextPath = relative(prepared.result.pack), receiptPath = relative(prepared.result.receipt);
    const reference = {projectId:project.id,contextPath,receiptPath};
    const context = await api.otter.context(reference);
    ensure(context.contextId===fixture.taskInput.context_id && context.apiText.includes('Fixture'), 'Context transport failed');
    const sessionId = 'otter:'+project.id+':'+context.contextId+':native-smoke';
    const events = [];
    const response = await new Promise(async (done, fail) => {
      const timeout=setTimeout(()=>{unsubscribe();fail(new Error('Native Faux run timed out'));},15000);
      const unsubscribe=api.events.subscribe(event=>{
        if(event.payload.sessionId!==sessionId)return;
        events.push(event.type);
        if(event.type==='agent.error'){clearTimeout(timeout);unsubscribe();fail(new Error(event.payload.message));}
        if(event.type==='agent.message_completed'){clearTimeout(timeout);unsubscribe();done(event.payload);}
      });
      try { await api.extrasAgents.run({sessionId,task:{agentId:'chat-normal',profileId:'default',input:{otter:reference}},conversation:{message:'仅讨论隔离测试来源，不修改事实。'}}); }
      catch(error){clearTimeout(timeout);unsubscribe();fail(error);}
    });
    ensure(response.runtime.mode==='local-faux', 'Smoke must never use a paid API');
    const delivered = await api.otter.stageDraft({...reference,title:'桌面隔离测试片段',body:'Fixture candidate: a blue paper crane.',authorIntent:'在隔离测试夹具验证候选稿交付。'});
    ensure(delivered.result.phase==='awaiting_author_review' && delivered.result.model==='unknown', 'Candidate delivery/unknown identity failed');
    let reused=false;try{await api.otter.context(reference);reused=true;}catch{}
    ensure(!reused,'Completed Context was reused for a new prose task');
    const review=await api.otter.reviewPage();
    ensure(review.url==='otter-review://app/','Review used a network URL');
    document.querySelector('[data-testid="otter-tab-review"]')?.click();
    await api.otter.setReviewBounds({x:220,y:100,width:900,height:600});
    return {status:'ok',projectId:project.id,projectPath:project.relativePath,contextId:context.contextId,
      events,artifact:delivered.result.artifact,viewReadonly:true,
      runtime:response.runtime.mode,contextReuseRejected:true};
  })(${JSON.stringify(fixture)}).catch(error=>{throw new Error(error?.message || String(error))})`,
    true
  )) as Record<string, unknown>;

  const contents = service.reviewContentsForSmoke();
  if (!contents || contents.getURL() !== "otter-review://app/")
    throw new Error("Native isolated author view did not open.");
  const review = (await contents.executeJavaScript(
    `(async()=>{
    const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
    ensure(typeof window.deepwrite==='undefined' && typeof require==='undefined','Author page received Node or privileged desktop preload');
    const info=await fetch('/api/projects').then(response=>response.json());
    ensure(info.projects.length===1 && info.token,'Live review source failed to discover the fixture');
    const project=info.projects[0];
    const catalog=await fetch('/api/catalog?project='+encodeURIComponent(project.id)).then(response=>response.json());
    ensure(catalog.files.length>0,'Candidate draft not visible in author review');
    const sourceResponse=await fetch('/api/source?project='+encodeURIComponent(project.id)+'&id='+encodeURIComponent(catalog.files[0].id));
    ensure(sourceResponse.ok,'Candidate source request failed');
    const source=await sourceResponse.json();
    const request={project:project.id,volume:catalog.files[0].volume,chapter:catalog.files[0].chapter,fileIds:[catalog.files[0].id],activeFileId:catalog.files[0].id};
    const saved=await fetch('/api/reading-context',{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':info.token},body:JSON.stringify(request)});
    ensure(saved.ok,'Protocol-backed author reading handoff failed');
    const deadline=Date.now()+10000;
    while(!document.querySelector('#columns')?.childElementCount && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    ensure(document.querySelector('#columns')?.childElementCount,'Author page did not render reading columns');
    return {status:'ok',url:location.href,privilegedBridge:false,fileCount:catalog.files.length,sourceLoaded:!!source};
  })()`,
    true
  )) as Record<string, unknown>;
  const handoffFile = join(
    fixture.workspaceRoot,
    "06_脚本工具",
    "小说对照工作台",
    "data",
    "current-context.json"
  );
  const handoff = JSON.parse(await readFile(handoffFile, "utf8"));
  if (!handoff.project)
    throw new Error("Author handoff contract was not persisted.");
  const personal = await runPersonalFeatureSmoke(window);
  await writeFile(
    fixture.screenshotPath,
    (await contents.capturePage()).toPNG()
  );
  await window.webContents.executeJavaScript(
    "window.deepwrite.otter.setReviewBounds(null)",
    true
  );
  await window.webContents.executeJavaScript(
    `(async()=>{
    const navigation=document.querySelector('.left-sidebar [data-testid="otter-tab-story"]');
    if(!navigation)throw new Error('Personal story navigation is missing');
    navigation.click();
    const deadline=Date.now()+5000;
    while(navigation.getAttribute('aria-current')!=='page' && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    if(navigation.getAttribute('aria-current')!=='page')throw new Error('Personal sidebar did not change the active section');
    const story=document.querySelector('.otter-story-space');
    if(!story||getComputedStyle(story).display==='none')throw new Error('Story space did not become visible');
    await new Promise(resolve=>setTimeout(resolve,1200));
  })()`,
    true
  );
  await writeFile(
    fixture.screenshotPath.replace(/\.png$/, "-shell.png"),
    (await window.webContents.capturePage()).toPNG()
  );
  return {
    ...result,
    review,
    handoff: true,
    screenshot: fixture.screenshotPath,
    personal
  };
}

async function runPersonalFeatureSmoke(window: BrowserWindow) {
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const api=window.deepwrite;const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
    const created=await api.otter.createProject({title:'Personal desktop fixture'});
    const idea=await api.otter.saveConcept({projectId:created.projectId,title:'Unassigned plot idea',content:'Fixture-only open idea; no chapter or new fact.'});
    const world=await api.otter.saveWorldNote({projectId:created.projectId,title:'World possibility',content:'Fixture-only possible setting, still unconfirmed.'});
    const map=await api.otter.saveMapNote({projectId:created.projectId,title:'Place sketch',content:'Fixture-only location sketch, not confirmed geography.'});
    const space=await api.otter.storySpace({projectId:created.projectId});
    ensure(space.concepts.length&&space.world.length&&space.documents.some(doc=>doc.category==='map'&&doc.path===map.path),'Story space candidate views failed');
    const discussion=await api.otter.prepareDiscussion({projectId:created.projectId,topic:'Review an unassigned fixture idea without inventing facts',sources:[idea.path,world.path,map.path]});
    ensure(discussion.contextId&&discussion.receiptPath,'Project discussion context was not prepared');
    const reference={projectId:discussion.projectId,contextPath:discussion.contextPath,receiptPath:discussion.receiptPath};
    const handoff=await api.otter.manualHandoff({projectId:created.projectId,context:reference,sources:[],instructions:'Fixture-only manual handoff. Do not call any external service.'});
    ensure(handoff.prompt.includes(handoff.reportPath),'Manual handoff omitted output path');
    const plan=await api.otter.prepareTeam({context:reference,teamIds:['review'],topic:'Independently review the fixture idea',material:'A fixture discussion, not a fact.',mode:'review'});
    ensure(plan.members.length===3&&new Set(plan.members.map(m=>m.request.task.input.otter.contextPath)).size===3,'Team members shared a completable context');
    const outputs=await Promise.all(plan.members.map(member=>new Promise(async(resolve,reject)=>{
      const timeout=setTimeout(()=>{unsubscribe();reject(new Error('Team fixture timed out'));},15000);
      const unsubscribe=api.events.subscribe(event=>{if(event.payload.sessionId!==member.request.sessionId)return;if(event.type==='agent.error'){clearTimeout(timeout);unsubscribe();reject(new Error(event.payload.message));}if(event.type==='agent.message_completed'){clearTimeout(timeout);unsubscribe();resolve(event.payload.runtime.mode);}});
      try{await api.extrasAgents.run(member.request);}catch(error){clearTimeout(timeout);unsubscribe();reject(error);}
    })));
    ensure(outputs.every(mode=>mode==='local-faux'),'Native team test must never use paid models');
    return {status:'ok',newProject:true,unassignedDiscussion:true,worldAndMap:true,independentTeamContexts:plan.members.length,teamRuntime:'local-faux',handoff};
  })().catch(error=>{throw new Error(error?.message || String(error))})`);
  const data = result as {
    handoff: { handoffId: string; reportPath: string };
    status: string;
    newProject: boolean;
    unassignedDiscussion: boolean;
    worldAndMap: boolean;
    independentTeamContexts: number;
    teamRuntime: string;
  };
  await writeFile(
    data.handoff.reportPath,
    "# Fixture opinion\n\nSynthetic local report. No external Codex call.\n"
  );
  const readback = (await window.webContents.executeJavaScript(
    `window.deepwrite.otter.manualReport(${JSON.stringify({ handoffId: data.handoff.handoffId })})`
  )) as { status: string; markdown: string | null };
  if (
    readback.status !== "pending" ||
    !readback.markdown?.includes("Synthetic local")
  )
    throw new Error("Manual report readback failed.");
  const { handoff: omitted, ...summary } = data;
  void omitted;
  return { ...summary, manualReadback: true };
}
