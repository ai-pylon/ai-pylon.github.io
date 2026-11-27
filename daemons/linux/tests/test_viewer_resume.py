import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch,Mock
spec=importlib.util.spec_from_file_location('resume',Path(__file__).resolve().parents[1]/'caps/cdp.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
 def test_exact_owner_project_profile_and_session_rotation(self):
  url='https://console.cloud.google.com/auth/clients?project=example-project'
  args={'confirm':True,'url':url,'profile':'temporary','graphical':True}
  record={'owner':'fixture-owner','session':'old','initial_url':url,'profile':None,'graphical':True,'tab':'fixture'}
  proc=Mock();proc.poll.return_value=None
  with patch.object(c,'_VIEWER',record),patch.object(c,'_PROC',proc),patch.object(c,'_viewer',return_value={}) as live:
   for a,ctx in [(args,{'user':'another-owner'}),({**args,'url':'https://example.com'}, {'user':'fixture-owner'}),({**args,'profile':'another'}, {'user':'fixture-owner'}),({**args,'graphical':False},{'user':'fixture-owner'}),({**args,'confirm':False},{'user':'fixture-owner'})]:
    with self.assertRaises(ValueError):c.viewer_resume(a,ctx)
   self.assertEqual(record['session'],'old');live.assert_not_called()
   r=c.viewer_resume(args,{'user':'fixture-owner'})
   self.assertTrue(r['ok']);self.assertNotEqual(r['session'],'old');self.assertEqual(record['session'],r['session'])
   live.assert_called_once_with({'session':'old'},{'user':'fixture-owner'})
