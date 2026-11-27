import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('lab_fixture',Path(__file__).resolve().parents[1]/'caps/cdp.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
    def test_held_pointer_state(self):
        v={'purpose':'lab','lab_url':'data:fixture','pressed':False,'frame_size':(100,100)}
        with patch.object(c,'_VIEWER',v),patch.object(c,'_viewer',return_value={'id':'fixture'}),patch.object(c,'_viewport',return_value=(100,100)),patch.object(c,'_command',side_effect=lambda t,m,p:{'result':{'value':'data:fixture'}} if m=='Runtime.evaluate' else {}) as cmd:
            for kind in ('down','move','up'):
                r=c.viewer_lab_pointer({'kind':kind,'payload':{'xf':.5,'yf':.5}}, {'user':'A'})
                self.assertTrue(r['applied'])
            sent=[a.args[2] for a in cmd.call_args_list if a.args[1]=='Input.dispatchMouseEvent']
            self.assertEqual([(x['type'],x['buttons']) for x in sent],[('mousePressed',1),('mouseMoved',1),('mouseReleased',0)])
            self.assertFalse(v['pressed'])
            v['purpose']='workspace';self.assertFalse(c.METHODS['viewer_lab_pointer']({'kind':'down','payload':{'xf':.5,'yf':.5}},{'user':'A'})['ok'])
            v['purpose']='lab';v['lab_url']='different';self.assertFalse(c.METHODS['viewer_lab_pointer']({'kind':'down','payload':{'xf':.5,'yf':.5}},{'user':'A'})['ok'])
    def test_cancel_and_invalid_input(self):
        v={'purpose':'lab','lab_url':'data:fixture','pressed':True,'last_pointer':(10,20),'frame_size':(100,100)}
        with patch.object(c,'_VIEWER',v),patch.object(c,'_lab_target',return_value={'id':'fixture'}),patch.object(c,'_command') as cmd:
            self.assertTrue(c.viewer_lab_pointer({'kind':'cancel','payload':{}},{'user':'A'})['applied'])
            cmd.assert_called_once_with({'id':'fixture'},'Input.dispatchMouseEvent',{'x':10,'y':20,'type':'mouseReleased','button':'left','buttons':0,'clickCount':1})
            self.assertFalse(v['pressed'])
            self.assertFalse(c.METHODS['viewer_lab_pointer']({'kind':'down','payload':{'xf':-1,'yf':.5}},{'user':'A'})['ok'])
    def test_fixture_only(self):
        self.assertTrue(c._lab_document().startswith('data:text/html;base64,'))
        self.assertFalse(c.METHODS['viewer_lab_open']({'confirm':True,'url':'https://example.org'},{'user':'A'})['ok'])
    def test_workspace_pointer_and_scope(self):
        v={'purpose':'workspace','frame_size':(100,100)}
        with patch.object(c,'_VIEWER',v),patch.object(c,'_viewer',return_value={'id':'fixture'}),patch.object(c,'_viewport',return_value=(100,100)),patch.object(c,'_command',return_value={}) as cmd:
            for kind in ('pointer_down','pointer_move','pointer_up'):
                self.assertTrue(c.viewer_input({'kind':kind,'payload':{'xf':.5,'yf':.5}}, {'user':'A'})['applied'])
            events=[a.args[2] for a in cmd.call_args_list if a.args[1]=='Input.dispatchMouseEvent']
            self.assertEqual([(x['type'],x['buttons']) for x in events],[('mousePressed',1),('mouseMoved',1),('mouseReleased',0)])
            self.assertFalse(v['pressed'])
            for purpose in ('setup','lab'):
                v['purpose']=purpose
                self.assertFalse(c.METHODS['viewer_input']({'kind':'pointer_down','payload':{'xf':.5,'yf':.5}},{'user':'A'})['ok'])
    def test_workspace_cancel_before_resume_or_navigation(self):
        v={'purpose':'workspace','owner':'A','session':'old','profile':None,'graphical':True,'pressed':True,'last_pointer':(20,30),'frame_size':(100,100)}
        with patch.object(c,'_VIEWER',v),patch.object(c,'_viewer',return_value={'id':'fixture'}),patch.object(c,'_command',return_value={}) as cmd:
            r=c.viewer_reconnect({'confirm':True},{'user':'A'})
            self.assertNotEqual(r['session'],'old')
            self.assertFalse(v['pressed'])
            v['pressed']=True
            self.assertTrue(c.viewer_navigate({'session':r['session'],'url':'https://example.com'},{'user':'A'})['ok'])
            self.assertFalse(v['pressed'])
            self.assertEqual([x.args[2]['type'] for x in cmd.call_args_list if x.args[1]=='Input.dispatchMouseEvent'],['mouseReleased','mouseReleased'])
