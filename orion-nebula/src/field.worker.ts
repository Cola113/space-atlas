import { buildField } from './Field';
self.onmessage=async()=>{
 try{
  const response=await fetch('/orion-nebula/density-guide.webp');
  if(!response.ok)throw new Error('Density reference could not be loaded');
  const bitmap=await createImageBitmap(await response.blob());
  const canvas=new OffscreenCanvas(320,320),context=canvas.getContext('2d')!;
  context.drawImage(bitmap,0,0,320,320);bitmap.close();
  const guide={width:320,height:320,data:context.getImageData(0,0,320,320).data};
  const data=buildField(guide);self.postMessage({data},{transfer:[data.buffer]});
 }catch(error){self.postMessage({error:String(error)});}
};
