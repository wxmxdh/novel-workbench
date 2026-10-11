import type { BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

async function verifyMcpReadOnlyClient(endpointFile: string, bookId: string) {
  const node = process.env.DEEPWRITE_SMOKE_NODE;
  const clientPath = process.env.DEEPWRITE_SMOKE_CLIENT;
  if (!node || !clientPath)
    throw new Error(
      "Smoke runner did not provide isolated Node and MCP client paths."
    );
  const client = spawn(
    node,
    [clientPath, "--mcp", "--endpoint-file", endpointFile],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  );
  const lines = createInterface({ input: client.stdout });
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  lines.on("line", (line) => {
    const waiter = pending.shift();
    if (!waiter) return;
    try {
      const message = JSON.parse(line);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    } catch (error) {
      waiter.reject(
        error instanceof Error ? error : new Error("Invalid MCP response.")
      );
    }
  });
  const request = (id: number, method: string, params?: unknown) =>
    new Promise<unknown>((resolveResult, rejectResult) => {
      pending.push({ resolve: resolveResult, reject: rejectResult });
      client.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`
      );
    });
  try {
    const initialized = (await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "deepwrite-isolation-smoke", version: "1" }
    })) as { protocolVersion?: string; serverInfo?: { name?: string } };
    if (
      initialized.protocolVersion !== "2024-11-05" ||
      initialized.serverInfo?.name !== "novel-workbench"
    )
      throw new Error("Novel workbench MCP initialize response is invalid.");
    const listed = (await request(2, "tools/list")) as {
      tools?: Array<{ name?: string }>;
    };
    if (
      listed.tools?.length !== 1 ||
      listed.tools[0]?.name !== "novel_workbench_request"
    )
      throw new Error("Novel workbench MCP tool catalogue is invalid.");
    const called = (await request(3, "tools/call", {
      name: "novel_workbench_request",
      arguments: { operation: "capabilities" }
    })) as { content?: Array<{ text?: string }>; isError?: boolean };
    if (called.isError || !called.content?.[0]?.text)
      throw new Error("Novel workbench MCP capabilities tool call failed.");
    const capabilities = JSON.parse(called.content[0].text) as {
      kind?: string;
      books?: Array<{ id?: string }>;
      models?: unknown[];
      endpointFile?: string;
    };
    if (
      capabilities.kind !== "capabilities" ||
      !capabilities.books?.some((book) => book.id === bookId) ||
      !Array.isArray(capabilities.models) ||
      capabilities.endpointFile !== endpointFile
    )
      throw new Error("Novel workbench MCP returned invalid capabilities.");
    client.stdin.end();
    return {
      initialized: true,
      toolsListed: listed.tools.length,
      capabilitiesReadOnly: true
    };
  } finally {
    lines.close();
    if (client.exitCode === null) client.kill();
  }
}

/** Synthetic end-to-end check for long-form conversation separation and legacy history. */
export async function runLongConversationIsolationSmoke(window: BrowserWindow) {
  const fixture = await window.webContents.executeJavaScript(
    `(async () => {
      const api=window.deepwrite;
      if(!api?.long?.create||!api.conversationPersistence?.history) throw new Error('Long workspace and history APIs are required');
      const created=await api.long.create({title:'Conversation Isolation Fixture',genre:'其他'});
      if(!created) throw new Error('Synthetic book creation was canceled');
      const bookId=created.book.id;
      const first=created.book.workspaceIndex.plot.chapterCards[0];
      if(!first) throw new Error('Synthetic book has no initial chapter');
      const chapterTwoId='chapter_smoke_two';
      const now=new Date().toISOString();
      const operation={type:'chapter.create',chapterCard:{id:chapterTwoId,volumeId:first.volumeId,primaryArcId:first.primaryArcId,title:'隔离测试第二章',narrativeOrder:2},files:{chapterCardId:chapterTwoId,body:{id:'file_'+chapterTwoId+':body',path:'long/chapters/'+chapterTwoId+'/body.md',updatedAt:now},card:{id:'file_'+chapterTwoId+':card',path:'long/chapters/'+chapterTwoId+'/card.md',updatedAt:now},characterState:{id:'file_'+chapterTwoId+':character-state',path:'long/chapters/'+chapterTwoId+'/character-state.md',updatedAt:now},handoff:{id:'file_'+chapterTwoId+':handoff',path:'long/chapters/'+chapterTwoId+'/handoff.md',updatedAt:now},commitId:null}};
      const batch={updatedAt:now,operations:[operation]};
      const preview=await api.long.previewOperations({bookId,batch});
      await api.long.applyOperations({bookId,batch:{...batch,expectedImpact:preview.preview.confirmation}});
      const markers={legacy:'ISOLATION_SMOKE_LEGACY_HISTORY',discussion:'ISOLATION_SMOKE_STAGE_DISCUSSION',plot:'ISOLATION_SMOKE_STAGE_PLOT',chapterOne:'ISOLATION_SMOKE_CHAPTER_ONE',chapterTwo:'ISOLATION_SMOKE_CHAPTER_TWO'};
      const seed=async(logicalKey,marker,sessionId)=>{
        const key='conversation-history:'+encodeURIComponent(logicalKey), createdAt=new Date().toISOString();
        await api.conversationPersistence.history.commit({key,sessionId,batchId:'batch-'+sessionId,expectedRevision:0,generation:0,sequence:1,operations:[
          {type:'setMetadata',value:{sessionId,title:marker,preview:marker,draft:'',approvalMode:'request-approval',temperature:0.7,createdAt,updatedAt:createdAt}},
          {type:'setActive',sessionId},
          {type:'putMessage',messageId:'user-'+sessionId,position:0,value:{id:'user-'+sessionId,role:'user',content:marker+' user',createdAt,status:'completed'}},
          {type:'putMessage',messageId:'assistant-'+sessionId,position:1,value:{id:'assistant-'+sessionId,role:'assistant',content:marker+' assistant',createdAt,status:'completed'}}
        ]});
      };
      const encoded=encodeURIComponent(bookId);
      await seed('long:'+encoded+':chat',markers.legacy,'smoke-legacy');
      await seed('long:'+encoded+':stage:sources',markers.discussion,'smoke-stage-discussion');
      await seed('long:'+encoded+':stage:plot_design',markers.plot,'smoke-stage-plot');
      await seed('long:'+encoded+':chapter:'+first.id,markers.chapterOne,'smoke-chapter-one');
      await seed('long:'+encoded+':chapter:'+chapterTwoId,markers.chapterTwo,'smoke-chapter-two');
      return {bookId,chapterTwoId,firstChapterId:first.id,markers};
    })()`,
    true
  );
  const reloaded = new Promise<void>((resolveLoad) =>
    window.webContents.once("did-finish-load", () => resolveLoad())
  );
  window.webContents.reload();
  await reloaded;
  const result = (await window.webContents.executeJavaScript(
    `(async fixture => {
      const ensure=(value,message)=>{if(!value)throw new Error(message);};
      const waitFor=async(select,message,timeout=12000)=>{const end=Date.now()+timeout;let value;while(!(value=select())&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,50));ensure(value,message);return value;};
      const api=window.deepwrite, {bookId,chapterTwoId,markers}=fixture;
      const bookNodeId='long-book:'+bookId;
      const treeRow=id=>document.querySelector('[data-resource-id="'+id+'"]');
      const bookRow=await waitFor(()=>treeRow(bookNodeId),'Synthetic long book is missing from the workspace tree');
      const hasBookChildren=()=>Boolean(treeRow(bookNodeId+':root:plot_design'));
      if(bookRow.getAttribute('aria-expanded')==='true'&&!hasBookChildren()){
        bookRow.click();
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!hasBookChildren()) treeRow(bookNodeId)?.click();
      await waitFor(hasBookChildren,'Synthetic book navigation did not expand; aria-expanded='+treeRow(bookNodeId)?.getAttribute('aria-expanded'));
      const checks=[];
      const selectNode=async(id,ownMarker)=>{
        const row=await waitFor(()=>treeRow(id),'Workspace resource is missing: '+id+'; rendered IDs: '+JSON.stringify([...document.querySelectorAll('[data-resource-id]')].map(item=>item.getAttribute('data-resource-id'))));row.click();
        await waitFor(()=>document.body.innerText.includes(ownMarker),'Expected isolated conversation did not restore for '+id);
        const other=Object.values(markers).filter(marker=>marker!==markers.legacy&&marker!==ownMarker);
        ensure(!other.some(marker=>document.body.innerText.includes(marker)),'A different stage or chapter conversation leaked into '+id);
        checks.push({scope:id,isolated:true});
      };
      await selectNode(bookNodeId+':root:discussion',markers.discussion);
      await waitFor(()=>document.querySelector('[data-testid="long-legacy-history-open"]'),'Long workspace conversation controls did not mount');
      await selectNode(bookNodeId+':root:plot_design',markers.plot);
      const index=await api.long.getWorkspaceIndex({bookId});
      const firstChapter=index.workspaceIndex.plot.chapterCards[0];
      const chapterVolume=index.workspaceIndex.plot.volumes.find(item=>item.id===firstChapter.volumeId);
      ensure(chapterVolume,'Synthetic chapter volume is missing');
      const expand=async(id)=>{const row=await waitFor(()=>treeRow(id),'Workspace branch is missing: '+id);if(row.getAttribute('aria-expanded')!=='true')row.click();};
      await expand(bookNodeId+':presentation:chapters');
      await expand(bookNodeId+':root:draft');
      await expand(bookNodeId+':volume:'+chapterVolume.id);
      await selectNode(bookNodeId+':chapter:'+firstChapter.id,markers.chapterOne);
      await selectNode(bookNodeId+':chapter:'+chapterTwoId,markers.chapterTwo);
      const legacyButton=document.querySelector('[data-testid="long-legacy-history-open"]');legacyButton.click();
      const legacyDialog=await waitFor(()=>document.querySelector('[role="dialog"][aria-modal="true"]'),'Legacy read-only history did not open');
      await waitFor(()=>legacyDialog.innerText.includes(markers.legacy),'Legacy shared conversation could not be read');
      ensure(!legacyDialog.querySelector('textarea')&&!legacyDialog.querySelector('form'),'Legacy history exposes a composer or send form');
      ensure(![...legacyDialog.querySelectorAll('button')].some(button=>/发送|send|删除|delete/i.test(button.innerText)),'Legacy history exposes a mutating action');
      legacyDialog.querySelector('button')?.click();
      await waitFor(()=>!document.querySelector('[role="dialog"][aria-modal="true"]'),'Legacy history dialog did not close');
      const collaborationButton=await waitFor(()=>document.querySelector('[data-testid="long-collaboration-open"]'),'Collaboration entry is missing');collaborationButton.click();
      const collaboration=await waitFor(()=>document.querySelector('.collaboration-workspace[role="dialog"]'),'Collaboration workspace did not open');
      const tabs=[...collaboration.querySelectorAll('nav button')];ensure(tabs.length===3,'Expected all three collaboration tabs');
      tabs[0].click();ensure(collaboration.innerText.includes('要求核对与剧情发散'),'Novel collaboration tab did not open');
      const chapterSelect=collaboration.querySelector('.popup-select');
      ensure(chapterSelect&&collaboration.innerText.includes('隔离测试第二章'),'Collaboration chapter selector does not include the synthetic second chapter');
      chapterSelect.querySelector('button[role="combobox"]')?.click();
      const option=await waitFor(()=>[...document.querySelectorAll('[role="option"]')].find(item=>item.innerText.includes('隔离测试第二章')),'Second chapter option did not open');option.click();
      await waitFor(()=>chapterSelect.querySelector('.popup-select-label')?.innerText.includes('隔离测试第二章'),'Collaboration chapter selector did not select the second chapter');
      tabs[1].click();await waitFor(()=>collaboration.innerText.includes('请 Codex 讨论'),'Codex discussion tab did not open');
      const modelCatalogue=await api.codexCollaboration.listModels();ensure(Array.isArray(modelCatalogue)&&modelCatalogue.length>0,'Read-only Codex model catalogue is unavailable');
      ensure(![...collaboration.querySelectorAll('button')].some(button=>/发送|send/i.test(button.innerText)),'Smoke must not start a Codex turn');
      tabs[2].click();await waitFor(()=>collaboration.innerText.includes('这里与工作台连接'),'Connection tab did not open');
      const chapterIndex=await api.long.getWorkspaceIndex({bookId});
      const chapter=chapterIndex.workspaceIndex.chapters.find(item=>item.chapterCardId===chapterTwoId);
      ensure(chapter,'Synthetic second chapter documents are missing');
      const prepared=await api.workbenchCollaboration.request({operation:'prepare',bookId,chapterCardId:chapterTwoId,fileIds:[chapter.card.id,chapter.body.id]});
      ensure(prepared.kind==='prepared'&&prepared.prepared.bookId===bookId&&prepared.prepared.chapterCardId===chapterTwoId,'Real workbench prepare response did not match the synthetic book and chapter');
      ensure(prepared.prepared.sources.length>0&&prepared.prepared.sources.every(source=>/^[a-f0-9]{64}$/.test(source.sha256)),'Prepared source hashes are invalid');
      const capabilities=await api.workbenchCollaboration.request({operation:'capabilities'});
      ensure(capabilities.kind==='capabilities'&&capabilities.books.some(book=>book.id===bookId)&&Array.isArray(capabilities.models)&&capabilities.endpointFile,'Real workbench capabilities response is incomplete');
      return {status:'ok',bookId,legacyReadOnly:true,stageIsolation:true,chapterIsolation:true,isolationChecks:checks,collaborationTabs:3,chapterSelector:true,chapterSelection:true,modelCatalogueReadable:true,preparedSourceCount:prepared.prepared.sources.length,capabilitiesReadable:true,endpointFile:capabilities.endpointFile,modelTurnStarted:false};
    })(${JSON.stringify(fixture)})`,
    true
  )) as {
    status: "ok";
    bookId: string;
    legacyReadOnly: boolean;
    stageIsolation: boolean;
    chapterIsolation: boolean;
    isolationChecks: Array<{ scope: string; isolated: boolean }>;
    collaborationTabs: number;
    chapterSelector: boolean;
    chapterSelection: boolean;
    modelCatalogueReadable: boolean;
    preparedSourceCount: number;
    capabilitiesReadable: boolean;
    endpointFile: string;
    modelTurnStarted: boolean;
  };
  const mcp = await verifyMcpReadOnlyClient(result.endpointFile, result.bookId);
  return { ...result, mcp };
}
