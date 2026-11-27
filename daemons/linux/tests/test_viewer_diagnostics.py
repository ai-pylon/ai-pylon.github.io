import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('diag',Path(__file__).resolve().parents[1]/'caps/cdp.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
 def test_sanitized_readonly_focus(self):
  args={'session':'fixture','expr':'untrusted'};ctx={'user':'fixture'}
  raw={'result':{'value':{'field':'password','focused':True,'viewport_width':1200,'viewport_height':800,'value':'fixture-private','html':'fixture-private'}}}
  with patch.object(c,'_viewer',return_value={'id':'fixture'}) as auth,patch.object(c,'_command',return_value=raw) as cd:
   r=c.viewer_diagnostics(args,ctx)
   auth.assert_called_once_with(args,ctx)
   self.assertEqual(r['field'],'password');self.assertTrue(r['focused'])
   self.assertNotIn('fixture-private',str(r))
   self.assertEqual(cd.call_args.args[1],'Runtime.evaluate')
   self.assertEqual(cd.call_args.args[2]['expression'],c._FOCUS_EXPRESSION)
   self.assertNotIn('.value',c._FOCUS_EXPRESSION)
   self.assertNotIn('untrusted',str(cd.call_args))
 def test_click_activates_tab_before_pointer_dispatch(self):
  def command(target,method,args):
   if method=='Page.getLayoutMetrics':return {'cssVisualViewport':{'clientWidth':1000,'clientHeight':700,'scale':1}}
   if method=='Runtime.evaluate':return {'result':{'value':'button'}}
   return {}
  with patch.object(c,'_viewer',return_value={}),patch.object(c,'_VIEWER',{'frame_size':(1000,700)}),patch.object(c,'_command',side_effect=command) as cd:
   r=c.viewer_input({'kind':'click','payload':{'xf':.5,'yf':.5}}, {'user':'fixture'})
   self.assertEqual(r,{'ok':True,'applied':True,'click_target':'button','press_ack':True,'release_ack':True})
   self.assertEqual([x.args[1] for x in cd.call_args_list],['Page.bringToFront','Page.getLayoutMetrics','Runtime.evaluate','Input.dispatchMouseEvent','Input.dispatchMouseEvent'])
   press,release=[x.args[2] for x in cd.call_args_list[-2:]]
   self.assertEqual((press['x'],press['y']),(499.5,349.5));self.assertEqual((press['buttons'],release['buttons']),(1,0))
 def test_changed_viewport_rejects_click_without_dispatch(self):
  with patch.object(c,'_viewer',return_value={}),patch.object(c,'_VIEWER',{'frame_size':(1000,700)}),patch.object(c,'_viewport',return_value=(1200,800)),patch.object(c,'_command',return_value={}) as cd:
   r=c.viewer_input({'kind':'click','payload':{'xf':.5,'yf':.5}}, {'user':'fixture'})
   self.assertFalse(r['ok']);self.assertEqual([x.args[1] for x in cd.call_args_list],['Page.bringToFront'])
 def test_capture_reports_real_viewport(self):
  record={}
  with patch.object(c,'_viewer',return_value={'url':'https://example.com'}),patch.object(c,'_VIEWER',record),patch.object(c,'_viewport',return_value=(1000,700)),patch.object(c,'_command',return_value={'data':'fixture'}):
   r=c.viewer_shot({}, {})
   self.assertEqual((r['w'],r['h']),(1000,700));self.assertEqual(record['frame_size'],(1000,700))
 def test_display_url_redacts_sensitive_parts(self):
  cases=[
   ('https://accounts.google.com/v3/signin/identifier?login_hint=fixture#secret','https://accounts.google.com/v3/signin/identifier'),
   ('https://accounts.google.com/v3/signin/challenge/pwd/private-fixture?token=secret','https://accounts.google.com/v3/signin/challenge/pwd/…'),
   ('https://console.cloud.google.com/auth/clients?project=fixture','https://console.cloud.google.com/auth/clients'),
   ('https://user:pass@example.com/private/secret?x=y#secret','https://example.com/…'),
   ('data:text/plain,secret','about:blank'),
   ('about:blank','about:blank'),
  ]
  for raw,expected in cases:self.assertEqual(c._display_url(raw),expected)
