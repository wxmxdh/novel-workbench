import type { BrowserWindow as BrowserWindowType } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fixture-only smoke for the native team review path. It prepares independent
 * V1 contexts and request envelopes but deliberately never starts a model run.
 */
export async function runTeamFlowSmoke(
  window: BrowserWindowType,
  projectId: string
) {
  const fixtureFile = process.env.DEEPWRITE_ORIGINAL_UI_FIXTURE;
  if (process.env.DEEPWRITE_SMOKE !== "1" || !fixtureFile)
    throw new Error("Team flow smoke requires a disposable fixture.");
  const fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as {
    workspaceRoot: string;
    projectIdHash: string;
    screenshotDirectory: string;
  };
  if (projectId !== fixture.projectIdHash)
    throw new Error(
      "Refusing team flow smoke outside the supplied fixture project."
    );
  if (process.env.DEEPWRITE_SMOKE !== "1")
    throw new Error("Team flow smoke lost its disposable fixture guard.");

  const seeded = (await window.webContents.executeJavaScript(
    `(async()=>{
      const api=window.deepwrite;
      const ensure=(value,message)=>{if(!value)throw new Error(message)};
      ensure(api?.models?.save&&api?.agentTeams?.create&&api?.otter?.prepareTeam,'Required public preload APIs are unavailable');
      const settings={models:[
        {id:'fixture-a',label:'Smoke Fixture A',provider:'fixture-only',modelId:'fixture-a',api:'openai-completions',baseUrl:'https://fixture-a.example.test/v1',reasoning:false,defaultThinkingLevel:'off',thinkingLevelOptions:['low','medium','high'],temperatureOptions:[0.1,0.7,1],contextWindow:100000,maxTokens:1024,enabled:true,apiKey:'invalid-fixture-only-key-a'},
        {id:'fixture-b',label:'Smoke Fixture B',provider:'fixture-only',modelId:'fixture-b',api:'openai-completions',baseUrl:'https://fixture-b.example.test/v1',reasoning:false,defaultThinkingLevel:'off',thinkingLevelOptions:['low','medium','high'],temperatureOptions:[0.1,0.7,1],contextWindow:100000,maxTokens:1024,enabled:true,apiKey:'invalid-fixture-only-key-b'}
      ],defaultModelId:'fixture-a'};
      const savedModels=await api.models.save(settings);
      ensure(savedModels.models.length===2&&savedModels.models.every(item=>item.hasApiKey),'Fixture-only model profiles did not persist');
      const teamName='Smoke Fixture Team '+Date.now();
      let catalog=await api.agentTeams.create({workspaceType:'long',name:teamName});
      const team=catalog.teams.find(item=>item.workspaceType==='long'&&item.name===teamName);
      ensure(team,'Could not create fixture long-form team through the public API');
      const settingsCopy=structuredClone(team.settings);
      const parent=settingsCopy.teams.find(item=>item.parentAgentId==='long');
      ensure(parent,'Long-form team is missing its long parent responsibility');
      parent.subagents.push({id:'fixture-reviewer',name:'Fixture Reviewer',description:'Disposable smoke role',systemPrompt:'Review only the supplied fixture sources; identify evidence and uncertainty.',enabled:true,modelMode:'custom',modelId:'fixture-a',thinkingLevel:'low'});
      catalog=await api.agentTeams.save({teamId:team.id,settings:settingsCopy});
      catalog=await api.agentTeams.setEnabled({teamId:team.id,enabled:true});
      const enabledTeam=catalog.teams.find(item=>item.id===team.id);
      ensure(catalog.enabledTeamIds.long===team.id&&enabledTeam?.settings.teams.find(item=>item.parentAgentId==='long')?.subagents.some(item=>item.id==='fixture-reviewer'&&item.enabled&&item.modelId==='fixture-a'),'Fixture long-form team member was not enabled');
      return {modelIds:savedModels.models.map(item=>item.id),teamId:team.id,teamName:team.name,memberId:'fixture-reviewer',invalidFixtureEndpoints:savedModels.models.map(item=>new URL(item.baseUrl).hostname)};
    })()`
  )) as {
    modelIds: string[];
    teamId: string;
    teamName: string;
    memberId: string;
    invalidFixtureEndpoints: string[];
  };

  // A normal renderer reload rehydrates model configuration from the fixture
  // store; no Vue component state is read or mutated by this smoke.
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("Renderer reload timed out during fixture team smoke.")
        ),
      20_000
    );
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  window.webContents.reload();
  await loaded;

  const result = (await window.webContents.executeJavaScript(
    `(async(projectId,expected)=>{
      const ensure=(value,message)=>{if(!value)throw new Error(message)};
      const waitFor=async(select,message,timeout=12000)=>{const end=Date.now()+timeout;let value;while(!(value=select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(value,message);return value};
      const api=window.deepwrite;ensure(api?.otter?.open,'Otter public API missing after reload');
      const projects=await api.otter.projects();ensure(projects.some(item=>item.id===projectId),'Fixture project is not available after renderer reload');
      const nav=await waitFor(()=>document.querySelector('[data-nav-id="otter-workbench"]'),'Novel workspace navigation missing');nav.click();
      await waitFor(()=>document.querySelector('[data-testid="otter-workbench"]'),'Novel workspace did not mount');
      const discussionId='novel:'+encodeURIComponent(projectId)+':discussion:';
      const discussion=await waitFor(()=>[...document.querySelectorAll('.tree-row[data-resource-id]')].find(row=>row.getAttribute('data-resource-id')===discussionId),'Fixture discussion tree entry missing');discussion.click();
      const input=await waitFor(()=>document.querySelector('.conversation-pane textarea[aria-label]'),'Native discussion input missing');
      const request='让智能体团队审核这份项目资料，分别说明依据、分歧和未知项。';
      const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;ensure(setter,'Cannot use native textarea input');
      setter.call(input,request);input.dispatchEvent(new Event('input',{bubbles:true}));
      const send=await waitFor(()=>document.querySelector('.conversation-pane button.send-button:not(.stop-button)'),'Native send control missing');
      send.click();
      const dialog=await waitFor(()=>document.querySelector('.team-run-dialog'),'Natural-language team request did not open the team selector');
      ensure(dialog.innerText.includes('团队审阅')&&dialog.innerText.includes('每位成员独立作答'),'Team selection dialog does not explain independent team responses');
      const selectedTeam=[...dialog.querySelectorAll('input[type="checkbox"]')].find(item=>item.checked&&item.closest('label')?.textContent?.includes(expected.teamName));
      ensure(selectedTeam,'Enabled fixture team was not selected in the team chooser');
      ensure(dialog.innerText.includes('Fixture Reviewer')&&dialog.innerText.includes('Smoke Fixture A'),'Fixture team member or its model did not appear in the visible chooser');
      ensure(dialog.querySelector('[data-testid="start-team-run"]')?.disabled,'Team execution became available before source preparation');
      const prepareButton=[...dialog.querySelectorAll('button')].find(button=>button.textContent?.includes('核对本轮资料'));
      ensure(prepareButton,'Team source preparation control missing');prepareButton.click();
      const noticed=[];const until=Date.now()+12000;let evidence;
      while(!(evidence=dialog.querySelector('[data-testid="team-source-evidence"]'))&&Date.now()<until){
        for(const item of document.querySelectorAll('[role="alert"], [role="status"], [aria-live], .ui-message')){const value=item.textContent?.trim();if(value&&!noticed.includes(value))noticed.push(value)}
        await new Promise(r=>setTimeout(r,50));
      }
      ensure(evidence,'V1 source evidence did not appear after preparing the team: '+JSON.stringify({noticed,topic:dialog.querySelector('textarea')?.value,dialog:dialog.innerText,body:document.body.innerText.slice(-2000)}));
      evidence.querySelector('details summary')?.click();
      await new Promise(r=>setTimeout(r,50));
      ensure(!dialog.querySelector('[data-testid="start-team-run"]')?.disabled,'Source preparation did not enable the explicit team start control');
      const evidenceText=evidence.innerText;
      ensure(evidence.querySelector('details ul li'),'V1 source path/effectiveness details are missing');
      const sourceRows=[...evidence.querySelectorAll('details ul li')].map(item=>item.innerText);
      ensure(sourceRows.length>0,'No actual V1 source rows are displayed');
      ensure(sourceRows.every(row=>row.includes('L')&&row.trim().length>0),'Prepared source paths or line ranges were not visibly rendered');
      ensure(!evidenceText.includes('已完成审核'),'UI implied that preparation itself completed the review');
      return {projectId,teamId:expected.teamId,teamName:expected.teamName,memberId:expected.memberId,requestRoutedToTeamChooser:true,modelCallsStarted:false,evidenceText,sourceRows};
    })(${JSON.stringify(projectId)},${JSON.stringify(seeded)})`
  )) as {
    projectId: string;
    teamId: string;
    teamName: string;
    memberId: string;
    requestRoutedToTeamChooser: boolean;
    modelCallsStarted: boolean;
    evidenceText: string;
    sourceRows: string[];
  };

  const plan = (await window.webContents.executeJavaScript(
    `(async(projectId,seed)=>{
      const api=window.deepwrite;const ensure=(value,message)=>{if(!value)throw new Error(message)};
      const view=await api.otter.open({projectId});
      const person=view.documents.find(item=>{const parts=item.path.toLowerCase().split('/');return item.category==='character'&&parts.at(-1)!=='index.md'&&!parts.some(part=>['archive','history','backup','归档','历史','备份'].includes(part))});
      const discussion=await api.otter.prepareDiscussion({projectId,topic:'Fixture team V1 context only',includeProjectPeople:true,...(person?{sources:[person.path]}:{})});
      const context={projectId:discussion.projectId,contextPath:discussion.contextPath,...(discussion.receiptPath?{receiptPath:discussion.receiptPath}:{})};
      const parsed=JSON.parse((await api.otter.context(context)).apiText);
      ensure(parsed.sources?.length>0,'Independent V1 context contains no sources');
      const teamPlan=await api.otter.prepareTeam({context,parentAgentId:'long',nativeTeamIds:[seed.teamId],memberKeys:[seed.teamId+'/'+seed.memberId],topic:'Fixture-only independent team request shape',material:'Smoke-only discussion material; no novel facts.',parentModelId:'fixture-a',mode:'review'});
      ensure(teamPlan.members.length===1,'Expected exactly one fixture team member');
      const member=teamPlan.members[0];
      const requestContext=member.request.task?.input?.otter;
      ensure(requestContext?.contextPath,'Prepared request omitted its V1 context path');
      ensure(member.context?.contextPath===requestContext.contextPath,'Member context and request context do not match');
      ensure(requestContext.contextPath!==context.contextPath,'Team member reused the parent context instead of receiving its own independent context');
      ensure(member.request.sessionId&&member.request.task?.input,'Prepared team request envelope is incomplete');
      ensure(member.request.modelId==='fixture-a','Prepared request did not route through the fixture model');
      return {projectId,sourceCount:parsed.sources.length,parentContextPath:context.contextPath,memberContextPath:requestContext.contextPath,contextsAreIndependent:context.contextPath!==requestContext.contextPath,requestSessionId:member.request.sessionId,requestModelId:member.request.modelId,requestTask:member.request.task,requestModelWasFixture:true,apiCallsExecuted:0};
    })(${JSON.stringify(projectId)},${JSON.stringify(seeded)})`
  )) as Record<string, unknown>;

  await writeFile(
    join(fixture.screenshotDirectory, "team-source-evidence.png"),
    (await window.webContents.capturePage()).toPNG()
  );
  await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('.team-run-dialog .header-text-button')?.click();
    const end=Date.now()+8000;
    while(document.querySelector('.team-run-dialog')&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
    if(document.querySelector('.team-run-dialog'))throw new Error('Team selector did not close before the next smoke scenario');
  })()`);
  return {
    ...result,
    preparedPlan: plan,
    fixtureModelIds: seeded.modelIds,
    fixtureEndpoints: seeded.invalidFixtureEndpoints,
    startedProviderRequest: false
  };
}
