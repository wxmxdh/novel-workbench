import { runReviewExperienceSmoke } from "./smoke-review-experience";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { dialog, type BrowserWindow as BrowserWindowType } from "electron";
import type { OtterDesktopService } from "../extras/otter/desktop-service";
import { runWarmGlassSmoke } from "./smoke-warm-glass";
import { runPersonalFitSmoke } from "./smoke-personal-fit";
import { runTeamFlowSmoke } from "./smoke-team-flow";
import { runNewBookSourcesSmoke } from "./smoke-newbook-sources";
import { runFullRepairSmoke } from "./smoke-full-repair";

/** Port-free visual smoke for the original workspace adapters; never invokes an agent/model. */
export async function runOriginalUiSmoke(
  window: BrowserWindowType,
  service: OtterDesktopService
) {
  const fixtureFile = process.env.DEEPWRITE_ORIGINAL_UI_FIXTURE;
  if (process.env.DEEPWRITE_SMOKE !== "1" || !fixtureFile)
    throw new Error("Original UI smoke requires a disposable fixture.");
  const fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as {
    workspaceRoot: string;
    projectRoot: string;
    projectId: string;
    projectIdHash: string;
    projectRelativePath: string;
    screenshotDirectory: string;
  };
  if (service.requireWorkspace() !== resolve(fixture.workspaceRoot))
    throw new Error(
      "Refusing original UI smoke outside the supplied fixture workspace."
    );
  // Retain shutdown exceptions as failing evidence in this disposable process.
  process.on("uncaughtException", (error) => {
    console.error(
      `DEEPWRITE_SMOKE_FAIL uncaught shutdown error: ${error.stack}`
    );
  });
  window.webContents.setBackgroundThrottling(false);
  window.showInactive();

  // Exercise the real preload -> IPC -> Main service path with a controlled
  // dialog result. This never opens a native chooser and is smoke-only.
  const originalShowOpenDialog = dialog.showOpenDialog;
  const selections = [
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: [fixture.workspaceRoot] },
    { canceled: false, filePaths: [fixture.projectRoot] }
  ];
  let selectionIndex = 0;
  Object.defineProperty(dialog, "showOpenDialog", {
    configurable: true,
    value: async () => {
      const selection = selections[selectionIndex++];
      if (!selection)
        throw new Error("Unexpected additional workspace chooser call.");
      return selection;
    }
  });
  let workspaceChooser: Record<string, unknown>;
  try {
    workspaceChooser = (await window.webContents.executeJavaScript(
      `(async(fixture)=>{
        const api=window.deepwrite;const before=await api.otter.settings();
        const canceled=await api.otter.chooseWorkspace();
        if(canceled!==null)throw new Error('Canceling workspace chooser did not return null');
        const chosen=await api.otter.chooseWorkspace();
        if(!chosen||chosen.workspaceRoot!==fixture.workspaceRoot)throw new Error('Valid workspace selection did not update settings to the fixture root: '+JSON.stringify(chosen));
        let rejected='';try{await api.otter.chooseWorkspace()}catch(error){rejected=String(error?.message||error)}
        if(!rejected.includes('小说工作区根目录')||!rejected.includes('单个作品文件夹'))throw new Error('Single-project selection did not explain the required novel workspace root: '+rejected);
        const after=await api.otter.settings();
        if(after.workspaceRoot!==fixture.workspaceRoot)throw new Error('Rejected single-project selection replaced the active workspace');
        return {cancelReturnedNull:canceled===null,validWorkspaceApplied:chosen.workspaceRoot===fixture.workspaceRoot,singleProjectRejected:true,clearChineseMessage:rejected,workspacePreserved:after.workspaceRoot===before.workspaceRoot};
      })(${JSON.stringify(fixture)})`,
      true
    )) as Record<string, unknown>;
    if (selectionIndex !== selections.length)
      throw new Error(
        `Workspace chooser smoke consumed ${selectionIndex}/${selections.length} selections.`
      );
  } finally {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: originalShowOpenDialog
    });
  }

  const result = (await window.webContents.executeJavaScript(
    `(async(fixture)=>{
      const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
      const waitFor=async(select,reason,timeout=10000)=>{const end=Date.now()+timeout;let found;while(!(found=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(found,reason);return found;};
      const api=window.deepwrite;ensure(api?.otter,'Desktop workspace API missing');
      const projects=await api.otter.projects();const project=projects.find(item=>item.id===fixture.projectIdHash);
      ensure(project,'Fictional test project not discovered through the real project API');
      const seededView=await api.otter.open({projectId:project.id});
      const seededCanon=seededView.documents.find(item=>item.category==='canon');
      ensure(seededCanon,'Synthetic project has no canon source for history seed');
      const context=await api.otter.prepareDiscussion({projectId:project.id,topic:'Synthetic UI smoke discussion',sources:[seededCanon.path]});
      const sessionId='otter:'+project.id+':'+context.contextId+':ui-smoke-20261002';
      const authorText='UI_SMOKE_AUTHOR_20261002：仅测试讨论，要求保留人物未知动机。';
      const modelText='UI_SMOKE_MODEL_20261002：提议增加一次误会，仍为候选不可写入正典。';
      const now=new Date().toISOString();
      const historyKey='conversation-history:'+encodeURIComponent('novel:'+project.id+':discussion');
      const history=api.conversationPersistence?.history;ensure(history,'Conversation history persistence API missing');
      await history.commit({key:historyKey,sessionId,batchId:'ui-smoke-batch-'+crypto.randomUUID(),expectedRevision:0,generation:0,sequence:1,operations:[
        {type:'setMetadata',value:{sessionId,draft:'',approvalMode:'request-approval',createdAt:now,updatedAt:now,temperature:0.7}},
        {type:'setActive',sessionId},
        {type:'putMessage',messageId:'ui-smoke-author',position:0,value:{id:'ui-smoke-author',role:'user',content:authorText,createdAt:now,status:'completed'}},
        {type:'putMessage',messageId:'ui-smoke-model',position:1,value:{id:'ui-smoke-model',role:'assistant',content:modelText,createdAt:now,status:'completed'}}
      ]});
      const persisted=await history.list({key:historyKey});
      const persistedMessages=await history.messages({key:historyKey,sessionId});
      ensure(persisted.activeSessionId===sessionId&&persistedMessages.messages.length===2,'Synthetic conversation history failed persistence readback: '+JSON.stringify({active:persisted.activeSessionId,sessions:persisted.sessions.map(item=>item.sessionId),messages:persistedMessages.messages.map(item=>item.value)}));
      const cached=JSON.parse(localStorage.getItem('novel.contextNavigation')||'{}');cached[sessionId]={context:{projectId:project.id,contextPath:context.contextPath,receiptPath:context.receiptPath},contextId:context.contextId,sources:[seededCanon.path]};localStorage.setItem('novel.contextNavigation',JSON.stringify(cached));
      const nav=await waitFor(()=>document.querySelector('[data-nav-id="otter-workbench"]'),'Novel workspace navigation missing');nav.click();
      await waitFor(()=>document.querySelector('[data-testid="otter-workbench"]'),'Novel workspace UI did not mount');
      const restoredConversation=await waitFor(()=>document.querySelector('.conversation-pane')&&document.body.innerText.includes(authorText)&&document.body.innerText.includes(modelText),'Novel workspace entry did not restore the native recent discussion');
      const oldOverviewCopy='从左侧作品目录进入人物、情节、大纲或正文';
      ensure(!document.body.innerText.includes(oldOverviewCopy),'Novel workspace entry still displays the obsolete overview page');
      const projectRootId='novel-project:'+encodeURIComponent(project.id);
      const discussionId='novel:'+encodeURIComponent(project.id)+':discussion:';
      const row=id=>document.querySelector('[data-resource-id="'+id+'"]');
      const projectEntry=await waitFor(()=>row(projectRootId),'Fixture project root tree node missing');
      let discussionEntry=await waitFor(()=>row(discussionId),'Direct free-discussion resource missing under the project root');
      const selectedTreeRows=()=>[...document.querySelectorAll('.tree-row.is-selected')];
      ensure(projectEntry!==discussionEntry&&projectEntry.getAttribute('data-resource-id')!==discussionEntry.getAttribute('data-resource-id'),'Project root and free discussion share one tree resource ID');
      ensure(!projectEntry.classList.contains('is-selected')&&discussionEntry.classList.contains('is-selected')&&selectedTreeRows().length===1,'Project and free discussion are not represented by one precise selected tree row: '+JSON.stringify(selectedTreeRows().map(item=>item.getAttribute('data-resource-id'))));
      ensure(projectEntry.getAttribute('aria-expanded')==='true','Active project root did not open to show its recent discussion');
      projectEntry.click();await waitFor(()=>projectEntry.getAttribute('aria-expanded')==='false','Project-root click did not only collapse its children');
      ensure(document.body.innerText.includes(authorText)&&document.body.innerText.includes(modelText)&&!projectEntry.classList.contains('is-selected'),'Collapsing the project root navigated away from the current native discussion');
      projectEntry.click();await waitFor(()=>projectEntry.getAttribute('aria-expanded')==='true','Project-root click did not reopen its children');
      discussionEntry=await waitFor(()=>row(discussionId),'Free discussion did not return after expanding project root');
      const modeToggle=await waitFor(()=>document.querySelector('[data-testid="novel-navigation-mode-toggle"]'),'Compact/full navigation switch missing');
      ensure(modeToggle.textContent.includes('完整'),'New project did not default to compact chapter navigation');
      modeToggle.click();
      await waitFor(()=>localStorage.getItem('novel.navigationMode')==='complete','Full-file navigation switch did not persist');
      const groupIds=['reference','writing','project-info'].map(id=>'novel-group:'+encodeURIComponent(project.id)+':'+id);
      const groups=groupIds.map(id=>row(id));
      ensure(groups.every(group=>group&&group.getAttribute('aria-expanded')==='false'),'Unselected resource groups should start collapsed: '+JSON.stringify(groups.map(group=>({id:group?.getAttribute('data-resource-id'),expanded:group?.getAttribute('aria-expanded')}))));
      const referenceGroup=groups[0];referenceGroup.click();
      await waitFor(()=>referenceGroup.getAttribute('aria-expanded')==='true','Clicking the materials group did not only expand it');
      ensure(discussionEntry.classList.contains('is-selected')&&document.body.innerText.includes(authorText),'Expanding a group changed the active native discussion');
      const characterEntry=await waitFor(()=>row('novel:'+encodeURIComponent(project.id)+':character:'),'Character category did not appear under the materials group');characterEntry.click();
      await waitFor(()=>characterEntry.classList.contains('is-selected'),'Selecting the character category did not update the active tree location');
      ensure(referenceGroup.getAttribute('aria-expanded')==='true'&&groups.slice(1).every(group=>group?.getAttribute('aria-expanded')==='false'),'Selected descendant should keep only its materials group expanded: '+JSON.stringify(groups.map(group=>({id:group?.getAttribute('data-resource-id'),expanded:group?.getAttribute('aria-expanded')}))));
      ensure(selectedTreeRows().length===1&&!projectEntry.classList.contains('is-selected'),'Character selection still highlights more than one project/category row');
      discussionEntry=await waitFor(()=>row(discussionId),'Free-discussion row disappeared after selecting a character category');discussionEntry.click();
      await waitFor(()=>discussionEntry.classList.contains('is-selected')&&document.body.innerText.includes(authorText)&&document.body.innerText.includes(modelText),'Selecting the direct free-discussion row did not restore the native conversation');
      referenceGroup.click();await waitFor(()=>referenceGroup.getAttribute('aria-expanded')==='false','Materials group did not collapse after returning to free discussion');
      const treeNavigation={projectRootId,discussionId,groupIds,characterId:'novel:'+encodeURIComponent(project.id)+':character:',rootAndDiscussionUseDistinctIds:true,onlyOneSelectedTreeRow:true,rootAndGroupClicksPreserveDiscussion:true,unselectedGroupsInitiallyCollapsed:true,selectedCharacterOpensOnlyMaterialsGroup:true,returnedToDirectDiscussion:true,selectors:{rows:'.tree-row[data-resource-id]',selectedRows:'.tree-row.is-selected',expandedState:'[aria-expanded]'}};
      const view=await api.otter.open({projectId:project.id});
      const canonDocument=view.documents.find(item=>item.category==='canon');
      ensure(canonDocument,'Synthetic project has no canon source for read-only integrity check');
      const canonBefore=await api.otter.read({projectId:project.id,path:canonDocument.path});
      const expected=['character','relationship','world','timeline','concept','plan','draft','annotation','canon','map','entry','protocol'];
      const categories=[...new Set(view.documents.map(item=>item.category))];
      ensure(expected.every(category=>categories.includes(category)), 'Fixture directory categories missing: '+expected.filter(category=>!categories.includes(category)).join(', ')+'. Actual documents: '+JSON.stringify(view.documents.map(item=>({category:item.category,path:item.path}))));
      await new Promise(r=>setTimeout(r,500));
      const snapshot=()=>({
        viewport:{width:innerWidth,height:innerHeight},
        shell:document.querySelector('[data-testid="desktop-shell"]')?.getBoundingClientRect().toJSON(),
        shellClasses:[...(document.querySelector('[data-testid="desktop-shell"]')?.classList||[])],
        sidebar:document.querySelector('.left-sidebar')?.getBoundingClientRect().toJSON(),
        conversation:document.querySelector('.conversation-pane')?.getBoundingClientRect().toJSON(),
        rightPane:document.querySelector('.editor-pane')?.getBoundingClientRect().toJSON(),
        composerFooter:document.querySelector('.conversation-pane footer.composer-wrap')?.getBoundingClientRect().toJSON(),
        sidebarFooter:document.querySelector('.left-sidebar > .sidebar-footer')?.getBoundingClientRect().toJSON(),
        treeCategories:[...document.querySelectorAll('.tree-label')].map(el=>el.textContent?.trim()).filter(Boolean).slice(0,80),
        bodyBackground:getComputedStyle(document.body).backgroundColor
      });
      const before=snapshot();
      ensure(before.conversation&&before.conversation.width>0,'Original conversation pane is not visible');
      ensure(before.rightPane&&before.rightPane.width>0,'Right reading pane is not visible');
      ensure(before.composerFooter&&before.composerFooter.bottom<=innerHeight+2&&before.composerFooter.bottom>before.composerFooter.top,'Conversation composer footer is outside the visible window');
      ensure(before.sidebarFooter&&before.sidebarFooter.bottom<=innerHeight+2&&before.sidebarFooter.bottom>before.sidebarFooter.top,'Sidebar profile footer is outside the visible window: '+JSON.stringify({footer:before.sidebarFooter,viewport:before.viewport,sidebar:document.querySelector('.left-sidebar')?.getBoundingClientRect().toJSON()}));
      const autoRestored=await waitFor(()=>document.body.innerText.includes(authorText)&&document.body.innerText.includes(modelText),'Synthetic messages were not automatically restored from active persisted history; key='+historyKey+' active='+persisted.activeSessionId+' session='+sessionId+' contextKeys='+JSON.stringify(Object.keys(cached))+' body='+document.body.innerText.slice(-1200));
      const historyButton=await waitFor(()=>[...document.querySelectorAll('button')].find(button=>/历史对话|conversation history/i.test((button.getAttribute('aria-label')||'')+' '+button.textContent)),'Conversation history control missing after discussion opened');historyButton.click();
      const historyRow=await waitFor(()=>[...document.querySelectorAll('.conversation-history-item')].find(button=>button.textContent?.includes('UI_SMOKE_AUTHOR_20261002')),'Seeded synthetic session missing from native conversation history list; active='+persisted.activeSessionId+' body='+document.querySelector('.conversation-history-panel')?.innerText);
      historyRow.click();
      await waitFor(()=>document.body.innerText.includes(authorText)&&document.body.innerText.includes(modelText),'History menu selection did not restore the synthetic messages');
      ensure(sessionId.startsWith('otter:'+project.id+':'),'Synthetic seeded conversation identity is invalid');
      const createNav=document.querySelector('[data-nav-id="create-book"]');
      createNav?.click();
      await new Promise(r=>setTimeout(r,250));
      const createDialog=!!document.querySelector('[role="dialog"]');
      ensure(createDialog,'New-work dialog did not open');
      document.querySelector('[role="dialog"] .dialog-close')?.click();
      await waitFor(()=>!document.querySelector('[role="dialog"]'),'New-work dialog did not close through its native close control');
      const more=document.querySelector('[data-nav-id="more"]');more?.click();await new Promise(r=>setTimeout(r,150));
      const aiDetection=document.querySelector('[data-feature-id="zhuque-detection"]');
      const aiDetectionVisible=!!aiDetection&&getComputedStyle(aiDetection).display!=='none';
      ensure(aiDetectionVisible,'AI text detection entry disappeared from More features');
      const beforeLeftCollapsed=before.shellClasses.includes('is-left-collapsed');
      ensure(!beforeLeftCollapsed,'Sidebar unexpectedly starts collapsed: '+JSON.stringify(before.shellClasses));
      const toggle=[...document.querySelectorAll('button')].find(el=>/collapse sidebar|收起.*侧栏|收起目录/i.test((el.getAttribute('aria-label')||'')+' '+(el.title||'')));
      ensure(toggle,'Sidebar collapse button missing');toggle.click();
      await waitFor(()=>document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Sidebar collapse state did not change');
      await new Promise(r=>setTimeout(r,500));
      const shell=document.querySelector('[data-testid="desktop-shell"]');
      const collapsed=!!shell?.classList.contains('is-left-collapsed');
      const collapsedSnapshot=snapshot();
      ensure(collapsed,'Sidebar collapse did not take effect; before='+JSON.stringify(before.shellClasses)+' after='+JSON.stringify(collapsedSnapshot.shellClasses)+' buttons='+JSON.stringify([...document.querySelectorAll('.left-sidebar button')].map(button=>({label:button.getAttribute('aria-label'),title:button.title,text:button.innerText})).slice(0,16)));
      ensure(collapsedSnapshot.conversation?.width>before.conversation.width,'Conversation did not gain width after sidebar collapse: '+JSON.stringify({before:before.conversation,after:collapsedSnapshot.conversation,shellBefore:before.shell,shellAfter:collapsedSnapshot.shell}));
      ensure(Math.abs(collapsedSnapshot.conversation.left)<=2,'Collapsed sidebar left an unused gutter instead of reaching the window edge: '+JSON.stringify({before:before.conversation,collapsed:collapsedSnapshot.conversation,sidebar:collapsedSnapshot.sidebar,viewport:collapsedSnapshot.viewport}));
      const expand=[...document.querySelectorAll('button')].find(el=>/展开左侧栏|expand sidebar/i.test((el.getAttribute('aria-label')||'')+' '+(el.title||'')));
      ensure(expand,'Expanded-layout restore control missing after sidebar collapse');expand.click();
      await waitFor(()=>!document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed'),'Could not restore three-column novel discussion layout');
      await new Promise(r=>setTimeout(r,500));
      const mainSnapshot=snapshot();
      const closeTo=(a,b)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=2;
      ensure(closeTo(mainSnapshot.conversation?.left,before.conversation.left)&&closeTo(mainSnapshot.conversation?.width,before.conversation.width)&&closeTo(mainSnapshot.sidebar?.width,before.sidebar.width)&&closeTo(mainSnapshot.rightPane?.left,before.rightPane.left)&&closeTo(mainSnapshot.rightPane?.width,before.rightPane.width),'Restored three-column layout geometry drifted from its original positions: '+JSON.stringify({before,after:mainSnapshot}));
      return {status:'ok',projectId:project.id,canonPath:canonDocument.path,realApiCategories:categories,documentCount:view.documents.length,workspaceEntryRestoredNativeDiscussion:!!restoredConversation,obsoleteOverviewAbsent:!document.body.innerText.includes(oldOverviewCopy),treeNavigation,autoHistoryRestored:!!autoRestored,historyMenuSelection:true,createDialog,aiDetectionVisible,sidebarCollapsed:collapsed,before,collapsedSnapshot,mainSnapshot};
    })(${JSON.stringify(fixture)}).catch(error=>{throw new Error(error?.message||String(error))})`,
    true
  )) as Record<string, unknown>;

  const personalFit =
    process.env.DEEPWRITE_PERSONAL_FIT === "1"
      ? await runPersonalFitSmoke(window, fixture.projectIdHash)
      : undefined;
  const outputDirectory = resolve(fixture.screenshotDirectory);
  const warmGlass = await runWarmGlassSmoke(window, outputDirectory);
  const settleCapture = async (selector: string): Promise<void> => {
    await window.webContents.executeJavaScript(
      `(async()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Screenshot target missing: '+${JSON.stringify(selector)});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(resolve=>setTimeout(resolve,220));const rect=node.getBoundingClientRect();if(rect.width<=0||rect.height<=0||rect.right<=0||rect.bottom<=0||rect.left>=innerWidth||rect.top>=innerHeight)throw new Error('Screenshot target is not visible: '+JSON.stringify(rect.toJSON()));return rect.toJSON();})()`,
      true
    );
  };
  await window.webContents.executeJavaScript(
    `(async()=>{const button=document.querySelector('[data-nav-id="create-book"]');if(!button)throw new Error('Create-work entry missing for isolated screenshot');button.click();const end=Date.now()+8000;while(!document.querySelector('[role="dialog"]')&&Date.now()<end)await new Promise(r=>setTimeout(r,50));if(!document.querySelector('[role="dialog"]'))throw new Error('Create-work dialog did not reopen for its dedicated screenshot');return true;})()`,
    true
  );
  await settleCapture('[role="dialog"]');
  await writeFile(
    `${outputDirectory}/original-ui-create.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  await window.webContents.executeJavaScript(
    `(async()=>{document.querySelector('[role="dialog"] .dialog-close')?.click();const end=Date.now()+8000;while(document.querySelector('[role="dialog"]')&&Date.now()<end)await new Promise(r=>setTimeout(r,50));if(document.querySelector('[role="dialog"]'))throw new Error('Create-work dialog stayed open before main screenshot');return true;})()`,
    true
  );
  await settleCapture(".conversation-pane");
  await writeFile(
    `${outputDirectory}/original-ui-main.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  const canonPath = String(result.canonPath);
  const projectRoot = resolve(fixture.projectRoot);
  const canonFile = resolve(projectRoot, canonPath);
  const canonRelative = relative(projectRoot, canonFile);
  if (canonRelative.startsWith("..") || isAbsolute(canonRelative))
    throw new Error(
      "Refusing fixture integrity check outside the synthetic project."
    );
  const canonHashBefore = createHash("sha256")
    .update(await readFile(canonFile))
    .digest("hex");
  const handoff = (await window.webContents.executeJavaScript(
    `(async()=>{
      const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
      const waitFor=async(select,reason,timeout=10000)=>{const end=Date.now()+timeout;let found;while(!(found=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(found,reason);return found;};
      const handoff=[...document.querySelectorAll('button')].find(el=>el.textContent?.trim()==='交接');
      handoff?.click();await new Promise(r=>setTimeout(r,350));
      const handoffPanel=document.querySelector('[data-testid="otter-manual-review"]');
      const discussionPreview=handoffPanel?.querySelector('[aria-label="本次讨论记录"]');
      const discussionState=discussionPreview?.textContent?.replace(/\\s+/g,' ').trim()||'';
      const panelRect=handoffPanel?.getBoundingClientRect().toJSON();
      const authorText='UI_SMOKE_AUTHOR_20261002：仅测试讨论，要求保留人物未知动机。';
      const modelText='UI_SMOKE_MODEL_20261002：提议增加一次误会，仍为候选不可写入正典。';
      const snapshotIncluded=discussionState.includes('2 条原文已随交接带入')&&discussionPreview?.textContent?.includes(authorText)&&discussionPreview?.textContent?.includes(modelText);
      ensure(handoffPanel&&snapshotIncluded,'Manual handoff did not auto-include the synthetic current discussion');
      ensure(panelRect&&panelRect.width>0&&panelRect.height>0&&panelRect.left>=-2&&panelRect.top>=-2&&panelRect.right<=innerWidth+2&&panelRect.bottom<=innerHeight+2,'Manual handoff panel is outside the visible viewport: '+JSON.stringify({panelRect,viewport:{width:innerWidth,height:innerHeight}}));
      ensure([...handoffPanel.querySelectorAll('.context-note')].some(note=>note.textContent?.includes('自动带入')),'Manual handoff did not indicate inherited Context sources');
      const generate=[...handoffPanel.querySelectorAll('button')].find(button=>button.textContent?.includes('生成 Codex 交接资料')||button.textContent?.includes('Prepare Codex handoff'));
      ensure(generate&&!generate.disabled,'Synthetic discussion was not eligible for local manual handoff');generate.click();
      const output=await waitFor(()=>handoffPanel.querySelector('.handoff-output details pre'),'Manual handoff prompt did not render',10000);
      ensure(output.textContent?.includes(authorText)&&output.textContent?.includes(modelText),'Manual handoff prompt omitted original discussion text');
      return {status:'ok',handoffPanel:!!handoffPanel,snapshotIncluded,manualHandoffContainsVerbatimMessages:true,discussionState,panelRect};
    })().catch(error=>{throw new Error(error?.message||String(error))})`,
    true
  )) as Record<string, unknown>;
  await settleCapture('[data-testid="otter-manual-review"]');
  await writeFile(
    `${outputDirectory}/original-ui-handoff.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  const canonHashAfter = createHash("sha256")
    .update(await readFile(canonFile))
    .digest("hex");
  const integrity = {
    canonPath,
    canonUnchanged: canonHashBefore === canonHashAfter,
    canonHashBefore,
    canonHashAfter
  };
  if (!integrity.canonUnchanged)
    throw new Error("Manual handoff changed the synthetic canon source bytes.");
  const settings = (await window.webContents.executeJavaScript(
    `(async()=>{const button=document.querySelector('[aria-label="打开设置"],[aria-label="Open settings"],[aria-label="openSettings"]');if(!button)throw new Error('Sidebar settings button missing');button.click();const end=Date.now()+8000;let root;while(!(root=document.querySelector('.settings-page'))&&Date.now()<end)await new Promise(r=>setTimeout(r,50));if(!root)throw new Error('Settings page did not open');const background=getComputedStyle(root).backgroundColor;const rgb=background.match(/\\d+/g)?.map(Number)||[];const warmBackground=rgb.length>=3&&rgb[0]>=rgb[1]&&rgb[1]>=rgb[2]&&rgb[0]-rgb[2]>=2&&rgb[0]-rgb[2]<=30&&rgb[0]<255;if(!warmBackground)throw new Error('Settings background is not the warm paper surface: '+background);const settingsText=root.innerText;const freeModelEntryPresent=/免费模型|Free Models|免费模型配置/i.test(settingsText);if(freeModelEntryPresent)throw new Error('Removed built-in free-model UI is still present in Settings');return {visible:true,background,warmBackground,freeModelEntryPresent,text:settingsText.slice(0,2400)};})()`,
    true
  )) as {
    visible: boolean;
    background: string;
    warmBackground: boolean;
    text: string;
  };
  await settleCapture(".settings-page");
  await writeFile(
    `${outputDirectory}/original-ui-settings.png`,
    (await window.webContents.capturePage()).toPNG()
  );
  const reviewExperience = await runReviewExperienceSmoke(
    window,
    service,
    outputDirectory
  );
  const teamFlow =
    process.env.DEEPWRITE_TEAM_FLOW === "1"
      ? await runTeamFlowSmoke(window, fixture.projectIdHash)
      : undefined;
  const newBookSources =
    process.env.DEEPWRITE_NEWBOOK_FLOW === "1"
      ? await runNewBookSourcesSmoke(window, fixture)
      : undefined;
  if (newBookSources) {
    await writeFile(
      `${outputDirectory}/newbook-source-reading.png`,
      (await window.webContents.capturePage()).toPNG()
    );
  }
  const evidence = {
    ...result,
    workspaceChooser,
    handoff,
    integrity,
    settings,
    warmGlass,
    ...(personalFit ? { personalFit } : {}),
    ...(teamFlow ? { teamFlow } : {}),
    ...(newBookSources ? { newBookSources } : {}),
    ...(newBookSources && process.env.DEEPWRITE_FULL_REPAIR === "1"
      ? {
          fullRepair: await runFullRepairSmoke(
            window,
            fixture,
            String(newBookSources.bookId)
          )
        }
      : {}),
    ...reviewExperience
  };
  await writeFile(
    `${outputDirectory}/original-ui-evidence.json`,
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  return {
    ...evidence,
    screenshots: [
      "original-ui-main.png",
      "original-ui-create.png",
      "original-ui-handoff.png",
      "original-ui-settings.png",
      "original-ui-review.png",
      "original-ui-review-content.png",
      ...(newBookSources ? ["newbook-source-reading.png"] : [])
    ]
  };
}
