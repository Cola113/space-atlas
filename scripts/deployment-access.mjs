// Optional credentials stay in the test process and only reach the selected origin.
export async function configureDeploymentAccess(context, base) {
  const secret=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if(!secret)return;
  const origin=new URL(base).origin;
  await context.route(`${origin}/**`,async route=>{
    await route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':secret}});
  });
}

export async function deploymentFetch(url, options={}) {
  const origin=new URL(process.env.ATLAS_URL).origin;
  const secret=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  for(let redirects=0;redirects<8;redirects++) {
    if(new URL(url).origin!==origin)throw new Error('Deployment request left selected origin (possibly an authentication redirect)');
    const response=await fetch(url,{...options,redirect:'manual',headers:{...options.headers,...(secret?{'x-vercel-protection-bypass':secret}:{})}});
    if(![301,302,303,307,308].includes(response.status))return response;
    url=new URL(response.headers.get('location'),url);
  }
  throw new Error('Too many deployment redirects');
}
