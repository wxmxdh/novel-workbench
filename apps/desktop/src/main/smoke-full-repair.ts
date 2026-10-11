import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { dialog, type BrowserWindow } from "electron";

/** Actual preload/IPC/Core with synthetic documents in the disposable smoke workspace. */
export async function runFullRepairSmoke(
  window: BrowserWindow,
  fixture: {
    workspaceRoot: string;
    projectRoot: string;
    projectIdHash: string;
  },
  bookId: string
) {
  if (
    process.env.DEEPWRITE_FULL_REPAIR !== "1" ||
    process.env.DEEPWRITE_SMOKE !== "1"
  )
    throw new Error("Disposable full-repair fixture required");
  const rel = relative(fixture.workspaceRoot, fixture.projectRoot);
  if (isAbsolute(rel) || rel.startsWith(".."))
    throw new Error("Fixture must stay inside smoke workspace");
  const sources = join(fixture.workspaceRoot, "synthetic_connected_sources");
  await mkdir(sources, { recursive: true });
  await writeFile(
    join(sources, "人物卡.md"),
    "\uFEFF# 合成人物\r\n仅供测试、不是已确认设定。\r\n"
  );
  await writeFile(join(sources, "讨论.txt"), "合成讨论待决定");
  await writeFile(join(sources, "credentials.md"), "should be skipped");
  const original = dialog.showOpenDialog;
  dialog.showOpenDialog = (async () => ({
    canceled: false,
    filePaths: [sources]
  })) as typeof dialog.showOpenDialog;
  try {
    const result = (await window.webContents.executeJavaScript(
      `(async(input)=>{
 const ensure=(v,m)=>{if(!v)throw new Error(m)};
 const wait=async(fn,m)=>{const end=Date.now()+15000;let value;while(!(value=await fn())&&Date.now()<end)await new Promise(r=>setTimeout(r,50));ensure(value,m);return value};
 const api=window.deepwrite;ensure(api?.long&&api?.books,'Required source/book APIs missing');
 const open=document.querySelector('[data-testid="long-book-sources-open"]');ensure(open,'Book sources action missing');open.click();
 const dlg=await wait(()=>document.querySelector('[data-testid="long-book-sources-dialog"]'),'Sources dialog missing');
 dlg.querySelector('[data-testid="source-folder-pick"]').click();
 await wait(()=>document.querySelector('.file-row'),'Folder preview missing');
 ensure(document.querySelectorAll('.file-row input[type="checkbox"]').length===2,'Folder preview should show only supported safe files');
 const confirm=document.querySelector('[data-testid="source-folder-confirm"]');ensure(confirm&&!confirm.disabled,'Selected folder cannot be connected');confirm.click();
 const connected=await wait(async()=>{const r=await api.long.getWorkspaceIndex({bookId:input.bookId});return r.workspaceIndex.sourceFolders?.[0]},'Connection did not persist');
 ensure(connected.authority==='reference','Source connection automatically promoted authority');
 const list=await api.long.querySourceFolder({bookId:input.bookId,sourceId:connected.id});ensure(list.listing.files.length===2,'Connected list mismatch');
 const file=list.listing.files.find(f=>f.relativePath==='人物卡.md');
 const doc=await api.long.querySourceFolder({bookId:input.bookId,sourceId:connected.id,fileId:file.id});ensure(doc.document.content.charCodeAt(0)===0xFEFF && doc.document.content.includes('# 合成人物'),'BOM/exact source bytes were not preserved');
 let rejected=false;try{await api.long.querySourceFolder({bookId:input.bookId,sourceId:connected.id,fileId:'outside-not-selected'});}catch{rejected=true};ensure(rejected,'Unselected file was readable');
 document.querySelector('.book-sources-dialog .dialog-close').click();
 return {folderPickerUi:true,folderPreviewFiltered:true,connectedReadOnly:true,exactBomSource:true,outOfScopeRejected:true,sourceId:connected.id,fileId:file.id};
 })(${JSON.stringify({ bookId })})`,
      true
    )) as Record<string, unknown>;
    await writeFile(
      join(sources, "人物卡.md"),
      "# 更新的合成人物\n仅是新的测试字节。\n"
    );
    const lifecycle = (await window.webContents.executeJavaScript(
      `(async(input)=>{
 const api=window.deepwrite;const ensure=(v,m)=>{if(!v)throw new Error(m)};
 const fresh=await api.long.querySourceFolder({bookId:input.bookId,sourceId:input.sourceId,fileId:input.fileId});ensure(fresh.document.content.startsWith('# 更新的合成人物'),'Connected source was stale');
 await api.long.disconnectSourceFolder({bookId:input.bookId,sourceId:input.sourceId});let rejected=false;try{await api.long.querySourceFolder({bookId:input.bookId,sourceId:input.sourceId});}catch{rejected=true}ensure(rejected,'Disconnected folder still readable');
 await api.long.unregister({bookId:input.bookId});const hidden=(await api.books.hidden()).find(b=>b.id===input.bookId&&b.kind==='native');ensure(hidden,'Native hidden book was not recoverable');
 await api.books.restore({id:hidden.id,kind:hidden.kind,expectedProjectDirectory:hidden.projectDirectory});const books=await api.long.list();ensure(books.books.some(b=>b.id===input.bookId),'Native restore failed');
 const old=await api.books.describeExternal({projectId:input.externalId});await api.books.removeExternal({projectId:old.id,action:'hide',expectedProjectDirectory:old.projectDirectory});ensure(!(await api.otter.projects()).some(b=>b.id===old.id),'External hidden book remains visible');
 await api.books.restore({id:old.id,kind:old.kind,expectedProjectDirectory:old.projectDirectory,expectedIdentitySha256:old.identitySha256,workspaceRoot:old.workspaceRoot});ensure((await api.otter.projects()).some(b=>b.id===old.id),'External restore failed');
 await api.long.delete({bookId:input.bookId});ensure(!(await api.long.list()).books.some(b=>b.id===input.bookId),'Synthetic native book still listed after delete');ensure(!(await api.books.hidden()).some(b=>b.id===input.bookId),'Deleted native book remains recoverable');
 return {liveSourceUpdates:true,disconnectionRevokesRead:true,nativeHideRestore:true,externalHideRestore:true,nativeDeleteClearsRegistry:true};
 })(${JSON.stringify({ bookId, sourceId: result.sourceId, fileId: result.fileId, externalId: fixture.projectIdHash })})`,
      true
    )) as Record<string, unknown>;
    return { status: "ok", ...result, ...lifecycle };
  } finally {
    dialog.showOpenDialog = original;
  }
}
