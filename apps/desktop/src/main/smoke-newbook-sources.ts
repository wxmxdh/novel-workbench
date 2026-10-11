import { createHash } from "node:crypto";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { isAbsolute, relative, resolve } from "node:path";

interface NewBookSmokeFixture {
  workspaceRoot: string;
  projectRoot: string;
}

/** Isolated native long-book creation and immutable source-import smoke. */
export async function runNewBookSourcesSmoke(
  window: BrowserWindowType,
  fixture: NewBookSmokeFixture
) {
  if (
    process.env.DEEPWRITE_SMOKE !== "1" ||
    process.env.DEEPWRITE_NEWBOOK_FLOW !== "1"
  ) {
    throw new Error(
      "New-book source smoke requires an explicit disposable fixture."
    );
  }
  const workspaceRoot = resolve(fixture.workspaceRoot);
  const projectRelativePath = relative(
    workspaceRoot,
    resolve(fixture.projectRoot)
  );
  if (projectRelativePath.startsWith("..") || isAbsolute(projectRelativePath)) {
    throw new Error(
      "Refusing new-book smoke outside the supplied fixture workspace."
    );
  }
  const marker = `SYNTHETIC_NEWBOOK_SOURCE_${Date.now()}`;
  const title = `新书流程隔离测试_${Date.now()}`;
  const sourceTitle = "合成讨论与大纲候选.md";
  const content = `# 隔离测试来源\r\n\r\n${marker}\r\n这些文字只是 smoke fixture，不是小说事实。\r\n`;
  const sourceSha256 = createHash("sha256")
    .update(content, "utf8")
    .digest("hex");

  const result = await window.webContents.executeJavaScript(
    `(async(input)=>{
      const ensure=(value,reason)=>{if(!value)throw new Error(reason);};
      const waitFor=async(select,reason,timeout=12000)=>{const end=Date.now()+timeout;let found;while(!(found=await select())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(found,reason);return found;};
      const api=window.deepwrite;ensure(api?.long,'Long-book API missing');
      let createNav=document.querySelector('[data-nav-id="create-book"]');
      if(!createNav&&document.querySelector('[data-testid="desktop-shell"]')?.classList.contains('is-left-collapsed')){
        const expand=[...document.querySelectorAll('button')].find(el=>/展开.*(?:侧栏|目录)|expand.*(?:sidebar|directory)/i.test((el.getAttribute('aria-label')||'')+' '+(el.title||'')+' '+(el.innerText||'')));
        ensure(expand,'Collapsed sidebar has no expand control before new-book smoke');expand.click();
        createNav=await waitFor(()=>document.querySelector('[data-nav-id="create-book"]'),'Sidebar did not reopen before new-book smoke');
      }
      if(!createNav){const back=[...document.querySelectorAll('button')].find(el=>/返回应用|back to app/i.test(el.innerText||''));back?.click();createNav=await waitFor(()=>document.querySelector('[data-nav-id="create-book"]'),'Could not return from settings to the application');}
      createNav.click();
      const dialog=await waitFor(()=>document.querySelector('[role="dialog"]:has(.create-book-advanced)'),'New-book dialog did not open');
      const typeTab=[...dialog.querySelectorAll('button')].find(el=>/长篇/.test(el.innerText||''));
      ensure(typeTab,'Long-form option missing from new-book dialog');
      if(!typeTab.classList.contains('is-selected'))typeTab.click();
      await new Promise(r=>setTimeout(r,50));
      const advanced=dialog.querySelector('details.create-book-advanced');
      ensure(advanced&&!advanced.open,'Optional skill/material bindings should start collapsed');
      const titleInput=dialog.querySelector('input[type="text"]');
      ensure(titleInput,'New-book title field missing');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(titleInput,input.title);titleInput.dispatchEvent(new Event('input',{bubbles:true}));titleInput.dispatchEvent(new Event('change',{bubbles:true}));
      const submit=dialog.querySelector('button[type="submit"]');ensure(submit&&!submit.disabled,'New-book submit should not require library bindings');submit.click();
      await waitFor(()=>document.querySelector('[role="dialog"]')===null,'New-book dialog did not complete');
      const books=await api.long.list();
      const book=books.books?.find(item=>item.title===input.title)||books.find?.(item=>item.title===input.title);
      ensure(book,'New long book was not persisted through the native workspace API');
      ensure(!Object.values(book.linkedSkillIdsByKind||{}).flat().length&&!Object.values(book.linkedMaterialIdsByKind||{}).flat().length,'New book should not automatically bind skills or materials');
      const indexResult=await api.long.getWorkspaceIndex({bookId:book.id});
      const workspaceIndex=indexResult.workspaceIndex;
      ensure(workspaceIndex.bookId===book.id&&Array.isArray(workspaceIndex.importedSources)&&workspaceIndex.importedSources.length===0,'New book should start with an empty source archive');
      await waitFor(()=>document.querySelector('.long-agent-conversation'),'New long book did not open directly into its discussion');
      const sourceButton=await waitFor(()=>document.querySelector('[data-testid="long-book-sources-open"]'),'Source import entry did not appear in the new-book discussion');
      ensure(document.querySelector('.long-agent-conversation').innerText.includes('自由讨论'),'New book did not start in free discussion');
      const addButton=document.querySelector('button[aria-label="添加附件或接入本书资料"]');ensure(addButton&&!addButton.disabled,'Composer source menu missing');addButton.click();
      const sourceMenu=await waitFor(()=>document.querySelector('.popup-select-menu[aria-label="添加附件或接入本书资料"]'),'Composer source menu did not open');
      ensure(['本次对话附件','导入文件','导入文件夹副本','连接只读文件夹','本书资料'].every(label=>sourceMenu.innerText.includes(label)),'File/folder/connection actions missing from composer');
      [...sourceMenu.querySelectorAll('button')].find(button=>button.innerText==='本书资料').click();
      await waitFor(()=>document.querySelector('[data-testid="long-book-sources-dialog"]'),'Composer source action did not open book sources');
      document.querySelector('[data-testid="long-book-sources-dialog"] .dialog-close').click();
      const fileInput=document.querySelector('[data-testid="long-source-import-file"]');
      ensure(fileInput,'Source import file input missing');
      const chooseSyntheticFile=()=>{const file=new File([input.content],input.sourceName,{type:'text/markdown'});const transfer=new DataTransfer();transfer.items.add(file);Object.defineProperty(fileInput,'files',{configurable:true,value:transfer.files});fileInput.dispatchEvent(new Event('change',{bubbles:true}));};
      const chooseFile=async()=>{sourceButton.click();const library=await waitFor(()=>document.querySelector('[data-testid="long-book-sources-dialog"]'),'Book sources dialog did not open');library.querySelector('[data-testid="source-file-pick"]')?.click();chooseSyntheticFile();};
      await chooseFile();
      const importDialog=await waitFor(()=>document.querySelector('[data-testid="long-source-import-dialog"]'),'Selecting a source did not open its review dialog');
      ensure((importDialog.querySelector('pre')?.textContent||'')===input.content,'Review dialog did not show the exact original text');
      const identity=importDialog.querySelector('button[aria-label="资料身份"]');ensure(identity&&!identity.disabled,'Source identity is not editable');identity.click();
      const identityMenu=await waitFor(()=>document.querySelector('.popup-select-menu[aria-label="资料身份"]'),'Identity choices did not open');
      ensure(Number(getComputedStyle(identityMenu).zIndex)>1200,'Identity menu is underneath its dialog');
      const reference=[...identityMenu.querySelectorAll('button')].find(el=>el.innerText==='仅供参考');ensure(reference,'Reference authority choice missing');
      const bounds=reference.getBoundingClientRect();ensure(reference.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)),'Identity choice is obscured by another layer');reference.click();
      await waitFor(()=>identity.innerText.includes('仅供参考'),'Selected source identity did not update');
      const firstPrepare=importDialog.querySelector('[data-testid="long-source-import-prepare"]');
      ensure(firstPrepare,'Source preview action missing before cancellation');firstPrepare.click();
      await waitFor(()=>{const dlg=document.querySelector('[data-testid="long-source-import-dialog"]');return dlg?.querySelector('[data-testid="long-source-import-confirm"]');},'Source preview was not staged before cancellation');
      document.querySelector('[data-testid="long-source-import-cancel"]')?.click();
      await waitFor(()=>!document.querySelector('[data-testid="long-source-import-dialog"]'),'Cancel did not close source review');
      let afterCancel=(await api.long.getWorkspaceIndex({bookId:book.id})).workspaceIndex;
      ensure(afterCancel.importedSources.length===0,'Cancel unexpectedly saved the source');
      await chooseFile();
      const confirmedDialog=await waitFor(()=>document.querySelector('[data-testid="long-source-import-dialog"]'),'Reselecting the source did not open review');
      const prepare=confirmedDialog.querySelector('[data-testid="long-source-import-prepare"]');
      ensure(prepare,'Source preview action missing');prepare.click();
      const stagedDialog=await waitFor(()=>{const dlg=document.querySelector('[data-testid="long-source-import-dialog"]');return dlg?.querySelector('[data-testid="long-source-import-confirm"]')?dlg:null;},'Source preview was not staged');
      ensure((stagedDialog?.querySelector('.source-import-hash code')?.textContent||'')===input.sourceSha256,'Staged UI preview hash does not match the exact source');
      stagedDialog.querySelector('[data-testid="long-source-import-confirm"]')?.click();
      await waitFor(()=>!document.querySelector('[data-testid="long-source-import-dialog"]'),'Confirm did not close source review');
      const refreshed=await waitFor(async()=>{const result=await api.long.getWorkspaceIndex({bookId:book.id});return result.workspaceIndex.importedSources?.length===1?result.workspaceIndex:null;},'Confirmed UI import did not refresh the native source list');
      const saved={source:refreshed.importedSources[0]};
      ensure(saved.source.authority==='undecided'&&saved.source.purpose==='foundation'&&saved.source.sourceSha256===input.sourceSha256,'Imported source metadata changed its undecided status or hash');
      const finalIndex=await api.long.getWorkspaceIndex({bookId:book.id});
      const indexed=finalIndex.workspaceIndex.importedSources.find(source=>source.id===saved.source.id);
      ensure(indexed&&indexed.file.id===saved.source.file.id,'Confirmed source is not in the native book index');
      const read=await api.long.readDocument({bookId:book.id,fileId:indexed.file.id,offset:0,maxCharacters:4096});
      ensure(read.content===input.content&&read.file.path===indexed.file.path,'Source could not be read back byte-for-byte');
      let readonlyMessage='';try{await api.long.writeDocument({bookId:book.id,fileId:indexed.file.id,content:'attempted overwrite'});}catch(error){readonlyMessage=String(error?.message||error);}
      ensure(/只读|read.only/i.test(readonlyMessage),'Imported original source was writable: '+readonlyMessage);
      const search=await api.long.search({bookId:book.id,query:input.marker,scope:'sources'});
      ensure(search.hits?.some(hit=>hit.fileId===indexed.file.id),'Imported source was missing from source search');
      sourceButton.click();await waitFor(()=>document.querySelector('[data-testid="long-book-sources-dialog"]'),'Book sources dialog did not reopen');
      const sourceRow=await waitFor(()=>[...document.querySelectorAll('.source-copy')].find(node=>(node.innerText||node.textContent||'').includes(input.sourceTitle)),'Imported source did not appear in the native source list');
      const sourceDetails=sourceRow.closest('details');if(sourceDetails)sourceDetails.open=true;
      sourceRow.click();
      await waitFor(()=>[...document.querySelectorAll('textarea,[contenteditable="true"],.long-workspace-editor')].some(node=>((node.value||node.innerText||node.textContent||'').includes(input.marker))),'Clicking the imported source did not open its original text');
      await new Promise(r=>setTimeout(r,750));
      ensure([...document.querySelectorAll('.long-workspace-editor')].some(node=>node.getBoundingClientRect().width>0&&(node.innerText||node.textContent||'').includes(input.marker)),'Imported source was lost after the selection settled: '+document.querySelector('.editor-pane')?.innerText?.slice(0,600));
      ensure(document.querySelector('.long-agent-conversation'),'Selecting/reading an imported source removed the discussion agent');
      return {status:'ok',bookId:book.id,title:book.title,creationUsedDialog:true,longTypeSelected:true,openedDirectlyIntoDiscussion:true,bindingsCollapsed:true,bindingsOptional:true,initialSources:0,stagedPreviewCancelledWithoutSaving:true,stagedExactContent:true,confirmedSource:true,authority:'undecided',indexedInSameBook:true,readBackExact:true,readonlyEnforced:true,searchable:true,openedFromSourceList:true,discussionAgentRemainsAvailable:true};
    })(${JSON.stringify({ title, sourceTitle, sourceName: sourceTitle, content, sourceSha256, marker })}).catch(error=>{throw new Error(error?.message||String(error))})`,
    true
  );
  return result as Record<string, unknown>;
}
