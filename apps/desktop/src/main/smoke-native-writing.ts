import { app, type BrowserWindow } from "electron";
import { resolve } from "node:path";

/** Real renderer/API smoke for native chapter draft versions, disposable profile only. */
export async function runNativeWritingSmoke(
  window: BrowserWindow,
  input: { bookId: string; chapterCardId: string }
) {
  const profile = process.env.DEEPWRITE_ACCUMULATION_SMOKE_ROOT;
  if (
    process.env.DEEPWRITE_SMOKE !== "1" ||
    !profile ||
    resolve(profile) !== resolve(app.getPath("userData"))
  )
    throw new Error(
      "Native writing smoke requires an explicit disposable profile."
    );

  const result = await window.webContents.executeJavaScript(
    `(async ({bookId,chapterCardId})=>{
    const ensure=(value,message)=>{if(!value)throw new Error(message)};
    const wait=async(get,message)=>{const end=Date.now()+12000;while(Date.now()<end){const value=await get();if(value)return value;await new Promise(done=>setTimeout(done,50));}throw new Error(message)};
    const api=window.deepwrite.long;
    const books=await api.list();
    const book=books.books.find(item=>item.id===bookId);
    ensure(book?.title==='剧情板块隔离验收','Refusing to write outside the disposable native-writing fixture book');
    let index=(await api.getWorkspaceIndex({bookId})).workspaceIndex;
    const chapter=index.plot.chapterCards.find(item=>item.id===chapterCardId);
    ensure(chapter,'Fixture chapter card is missing');
    const bodyFileId='file_'+chapterCardId+':body';
    const fixtureText='NATIVE_WRITING_SMOKE_FIXTURE_'+bookId+'_'+chapterCardId;
    const beforeList=await api.listNativeWriting({bookId,chapterCardId});
    const beforeCandidate=beforeList.items.find(item=>item.role==='candidate');
    const alreadyComplete=Boolean(beforeList.items.some(item=>item.role==='work')&&beforeCandidate?.important&&beforeCandidate.selectedReference&&beforeCandidate.sources.some(source=>source.model==='fixture-model-a')&&beforeCandidate.sources.some(source=>source.model==='fixture-model-b'));
    if(!alreadyComplete) await api.writeDocument({bookId,fileId:bodyFileId,content:fixtureText});
    const board=await wait(()=>document.querySelector('[data-testid="plot-planning-board"]'),'Native plot board is not visible');
    const card=[...board.querySelectorAll('li')].find(row=>row.textContent?.includes(chapter.title));
    ensure(card,'Fixture chapter row is not visible in the plot board');
    const panel=[...card.querySelectorAll('details.native-writing-panel')][0];
    ensure(panel,'Chapter draft-version panel is missing');
    if(!panel.open) panel.querySelector('summary')?.click();
    await wait(()=>panel.querySelector('.native-current-body'),'Current manuscript snapshot did not load');
    if(alreadyComplete){
      const body=(await api.readDocument({bookId,fileId:bodyFileId,offset:0,maxCharacters:1000})).content;
      ensure(body===fixtureText,'Previously completed fixture manuscript changed; refusing repeat writes');
      localStorage.setItem('deepwrite.native-writing-smoke',JSON.stringify({bookId,chapterCardId,fixtureText}));
      return {status:'pre-reload-ok',bookId,chapterCardId,alreadyComplete:true,readOnlyReopen:true,noModelCalls:true};
    }
    const click=(text)=>{const button=[...panel.querySelectorAll('button')].find(item=>item.textContent?.trim()===text);ensure(button,'Missing UI control: '+text);button.click()};
    const clickWhenEnabled=async(text)=>{const button=await wait(()=>[...panel.querySelectorAll('button')].find(item=>item.textContent?.trim()===text&&!item.disabled),'UI control did not become enabled: '+text);button.click()};
    await clickWhenEnabled('复制当前正文为工作稿');
    await wait(async()=>{const result=await api.listNativeWriting({bookId,chapterCardId});return result.items.some(item=>item.role==='work')},'Work draft was not saved through the UI');
    await wait(()=>panel.querySelectorAll('.native-writing-item').length===1,'Work draft did not finish rendering in the chapter panel');
    const history=panel.querySelector('details.native-writing-history');ensure(history,'Candidate history details are missing');if(!history.open)history.querySelector('summary')?.click();
    await wait(()=>history.open,'Candidate history did not expand');
    const modelInput=[...panel.querySelectorAll('label')].find(label=>label.textContent?.includes('模型（未知可保留 unknown）'))?.querySelector('input');
    const versionInput=[...panel.querySelectorAll('label')].find(label=>label.textContent?.includes('版本标记'))?.querySelector('input');
    ensure(modelInput&&versionInput,'Model/version fields are missing');
    const setInput=(element,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;ensure(setter,'Native input setter unavailable');setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))};
    setInput(modelInput,'fixture-model-a');setInput(versionInput,'fixture-v1');
    await clickWhenEnabled('复制当前正文为候选稿');
    await wait(async()=>{const result=await api.listNativeWriting({bookId,chapterCardId});return result.items.filter(item=>item.role==='candidate').length===1},'First candidate was not saved through the UI');
    await wait(()=>[...panel.querySelectorAll('.native-writing-model-group .native-writing-item')].some(item=>item.textContent?.includes('fixture-v1')),'First candidate did not finish rendering in history');
    setInput(modelInput,'fixture-model-b');setInput(versionInput,'fixture-v2');
    await clickWhenEnabled('复制当前正文为候选稿');
    let result=await wait(async()=>{const value=await api.listNativeWriting({bookId,chapterCardId});return value.items.filter(item=>item.role==='candidate').length===1&&value.items.find(item=>item.role==='candidate')?.sources.length===2?value:null},'Duplicate candidate source was not retained');
    const candidate=result.items.find(item=>item.role==='candidate');ensure(candidate,'Deduplicated candidate missing');
    await wait(()=>[...panel.querySelectorAll('.native-writing-model-group .native-writing-item')].some(item=>item.querySelector('details summary')?.textContent?.includes('2')),'Deduplicated source count did not finish rendering in history');
    const findCandidateCard=()=>[...panel.querySelectorAll('.native-writing-model-group .native-writing-item')].find(item=>item.textContent?.includes('fixture-v1'));
    const candidateCard=findCandidateCard();
    ensure(candidateCard,'Deduplicated candidate did not render');
    const reference=[...candidateCard.querySelectorAll('button')].find(button=>button.textContent?.trim()==='标为本章参考稿');
    ensure(reference,'Candidate reference action is missing');reference.click();
    await wait(async()=>{const value=await api.listNativeWriting({bookId,chapterCardId});return value.items.find(item=>item.role==='candidate')?.selectedReference},'Reference selection did not persist');
    await wait(()=>findCandidateCard()?.querySelector('.reference-label'),'Reference selection did not finish rendering in history');
    const checkpoint=[...(findCandidateCard()?.querySelectorAll('button')??[])].find(button=>button.textContent?.trim()==='标记为重要节点');
    ensure(checkpoint,'Candidate checkpoint action is missing');checkpoint.click();
    await wait(async()=>{const value=await api.listNativeWriting({bookId,chapterCardId});return value.items.find(item=>item.role==='candidate')?.important},'Important checkpoint did not persist');
    await wait(()=>findCandidateCard()?.querySelector('.checkpoint-label'),'Important checkpoint did not finish rendering in history');
    const before=(await api.readDocument({bookId,fileId:bodyFileId,offset:0,maxCharacters:1000})).content;
    ensure(before===fixtureText,'Candidate actions modified the manuscript body');
    localStorage.setItem('deepwrite.native-writing-smoke',JSON.stringify({bookId,chapterCardId,fixtureText}));
    return {status:'pre-reload-ok',bookId,chapterCardId,workSaved:true,candidateDeduplicated:true,bodyUnchanged:true,noModelCalls:true};
  })(${JSON.stringify(input)})`,
    true
  );
  const loaded = new Promise<void>((done) =>
    window.webContents.once("did-finish-load", () => done())
  );
  window.webContents.reload();
  await loaded;
  const persisted = await window.webContents.executeJavaScript(
    `(async()=>{
    const ensure=(value,message)=>{if(!value)throw new Error(message)};
    const fixture=JSON.parse(localStorage.getItem('deepwrite.native-writing-smoke')||'null');
    ensure(fixture,'Native writing smoke reload marker missing');
    const api=window.deepwrite.long;
    const result=await api.listNativeWriting({bookId:fixture.bookId,chapterCardId:fixture.chapterCardId});
    const candidate=result.items.find(item=>item.role==='candidate');
    ensure(candidate?.selectedReference&&candidate.important&&candidate.sources.length===2,'Candidate state did not persist after renderer reload');
    const body=(await api.readDocument({bookId:fixture.bookId,fileId:'file_'+fixture.chapterCardId+':body',offset:0,maxCharacters:1000})).content;
    ensure(body===fixture.fixtureText,'Renderer reload changed fixture manuscript bytes');
    localStorage.removeItem('deepwrite.native-writing-smoke');
    return {status:'ok',bookId:fixture.bookId,chapterCardId:fixture.chapterCardId,referencePersisted:true,checkpointPersisted:true,bodyUnchanged:true,rendererReload:true,noModelCalls:true};
  })()`,
    true
  );
  return {
    ...result,
    ...persisted,
    processReopened: result.alreadyComplete === true
  };
}
