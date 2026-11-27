import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('capacity',Path(__file__).resolve().parents[1]/'caps/cdp.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
 def tearDown(self):c.shutdown()
 def test_reserved_slot(self):
  with patch.object(c,'_ensure'),patch.object(c,'_tabs',return_value=[{}, {}, {}]),patch.object(c,'_http') as http:
   self.assertFalse(c.navigate({'url':'https://example.com'}, {})['ok']);http.assert_not_called()
 def test_full_legacy_tabs_blank_reused(self):
  tabs=[{'id':'blank','url':'about:blank'}]+[{'id':str(i),'url':'https://example.com'} for i in range(3)]
  with patch.object(c,'_ensure'),patch.object(c,'_tabs',return_value=tabs),patch.object(c,'_http') as http,patch.object(c,'_command',return_value={}) as cmd:
   self.assertTrue(c.viewer_open({'url':'https://example.com','confirm':True},{'user':'fixture'})['ok'])
   self.assertEqual(c._VIEWER['tab'],'blank');http.assert_not_called()
   self.assertEqual(cmd.call_args_list[0].args[1],'Page.navigate')
 def test_no_arbitrary_tab_discard(self):
  with patch.object(c,'_ensure'),patch.object(c,'_tabs',return_value=[{'url':'https://example.com'}]*4),patch.object(c,'_http') as http:
   with self.assertRaisesRegex(ValueError,'tab limit'):c.viewer_open({'url':'https://example.com','confirm':True},{'user':'fixture'})
   http.assert_not_called()
