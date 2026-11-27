"""Isolated AppUI viewer fixture; no real accounts or external sites."""
from pathlib import Path
import unittest
from playwright.sync_api import sync_playwright
SOURCE=Path(__file__).resolve().parents[1]/'src/components/remote-browser-viewer.js'
class TestRemoteBrowserViewer(unittest.TestCase):
 def test_shared_debugger(self):
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',chromium_sandbox=True,args=[]) # normal browser sandbox
   try:
    page=browser.new_page(viewport={'width':1200,'height':900})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="fixture" style="width:850px"></div>')
    page.add_script_tag(path=SOURCE)
    page.evaluate("""() => {
     window.received=[];
     const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/></svg>');
     const transport={
      shot:async()=>({ok:true,src,w:1200,h:800,url:'https://accounts.google.com/v3/signin/identifier?fixture=secret#secret',url_redacted:true}),
      stream:()=>{throw Error('fixture uses polling')},
      input:async(s,kind,p)=>{received.push({kind});return {ok:true,applied:true,click_target:'button',press_ack:true,release_ack:true}},
      stop:async()=>({ok:true})
     };
     window.v=AppUIRemoteBrowserViewer.create({session:'fixture-session',container:document.querySelector('#fixture'),transport,debugger:{readFocus:async()=>({ok:true,field:'text',focused:true}),boundedInput:true}});
    }""")
    page.locator('.appui-rbv-img').wait_for()
    page.wait_for_function("document.querySelector('.appui-rbv-url').textContent.includes('/v3/signin/identifier')")
    self.assertEqual(page.locator('.appui-rbv-url').inner_text(),'https://accounts.google.com/v3/signin/identifier')
    self.assertEqual(page.locator('.appui-rbv-url').get_attribute('title'),'https://accounts.google.com/v3/signin/identifier')
    page.wait_for_function("document.querySelector('.appui-rbv-debug').textContent.includes('Remote field: text')")
    page.locator('.appui-rbv-img').click(position={'x':80,'y':80})
    page.wait_for_function("document.querySelector('[aria-label=\"Mouse click diagnostics\"]').textContent.includes('Press/release ACK/ACK')")
    page.keyboard.type('fixture')
    page.wait_for_function("window.received.some(x=>x.kind==='type')")
    self.assertNotIn('fixture-session',page.locator('.appui-rbv-debug').inner_text())
    self.assertNotIn('fixture=secret',page.locator('.appui-rbv-debug').inner_text())
    self.assertEqual(errors,[])
    page.evaluate('v.destroy()')
    page.evaluate("""() => {window.v2=AppUIRemoteBrowserViewer.create({session:'fixture-2',container:document.querySelector('#fixture'),transport:{stream:()=>{throw Error('fixture')},shot:async()=>({ok:true,url:'https://example.com/private/fixture-secret?token=secret'}),stop:async()=>({ok:true})}})}""")
    page.wait_for_function("document.querySelector('.appui-rbv-url').textContent.includes('example.com')")
    self.assertEqual(page.locator('.appui-rbv-url').inner_text(),'https://example.com/…')
    self.assertEqual(page.locator('.appui-rbv-debug').count(),0)
    page.evaluate('v2.destroy()')
    self.assertEqual(errors,[])
   finally:browser.close()
if __name__=='__main__':unittest.main()
