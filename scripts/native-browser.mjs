// A private browser profile with native tab/window visibility. Normal
// Playwright launch enables focus emulation on its own protocol session;
// disabling it from a second session does not remove that first override.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export async function nativeBrowser(artifactsDir) {
  await mkdir('data',{recursive:true});
  const profile=await mkdtemp(path.resolve('data/native-browser-'));
  const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
    '--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run',
    '--no-default-browser-check','--disable-sync','--disable-background-networking',
    '--window-position=-32000,-32000','--disable-features=CalculateNativeWinOcclusion','about:blank',
  ],{stdio:'ignore',windowsHide:true});
  let browser;
  try {
    let port;
    for(let attempt=0;attempt<100;attempt++){
      try {port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}
      catch {await new Promise(resolve=>setTimeout(resolve,100));}
    }
    if(!/^\d+$/.test(port||''))throw new Error('Private browser endpoint did not start');
    browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,
      {noDefaults:true,isLocal:true,artifactsDir:path.resolve(artifactsDir)});
    const protocol=await browser.newBrowserCDPSession();
    await protocol.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:path.resolve(artifactsDir),eventsEnabled:true});
    return {browser,context:browser.contexts()[0],protocol,close:async()=>{
      await protocol.send('Browser.close').catch(()=>{});
      await browser.close();child.kill();
    }};
  } catch(error) {await browser?.close().catch(()=>{});child.kill();throw error;}
}
