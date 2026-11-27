import importlib.util, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('recovery_test',Path(__file__).resolve().parents[1]/'caps/cdp.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
    def test_owner_recovery_and_close(self):
        v={'purpose':'workspace','owner':'A','session':'old','graphical':True,'profile':None,'tab':'fixture'}
        with patch.object(c,'_VIEWER',v),patch.object(c,'_viewer',return_value={'id':'fixture'}) as viewer,patch.object(c,'_stop') as stop,patch.object(c,'_command',return_value={}) as command:
            for ctx,args in [({'user':'B'},{'confirm':True}),({'user':'A'},{'confirm':False})]:
                self.assertFalse(c.METHODS['viewer_reconnect'](args,ctx)['ok'])
                self.assertFalse(c.METHODS['viewer_close_existing'](args,ctx)['ok'])
            viewer.assert_not_called();stop.assert_not_called()
            r=c.viewer_reconnect({'confirm':True},{'user':'A'})
            self.assertNotEqual(r['session'],'old');self.assertEqual(r['profile'],'temporary')
            self.assertTrue(r['graphical'])
            self.assertTrue(c.viewer_navigate({'session':r['session'],'url':'https://example.org'},{'user':'A'})['ok'])
            command.assert_called_once_with({'id':'fixture'},'Page.navigate',{'url':'https://example.org'})
            v['purpose']='setup'
            self.assertFalse(c.METHODS['viewer_reconnect']({'confirm':True},{'user':'A'})['ok'])
            self.assertFalse(c.METHODS['viewer_close_existing']({'confirm':True},{'user':'A'})['ok'])
            self.assertFalse(c.viewer_navigate({'session':r['session'],'url':'https://example.org'},{'user':'A'})['ok'])
            v['purpose']='workspace'
            self.assertTrue(c.viewer_close_existing({'confirm':True},{'user':'A'})['ok']);stop.assert_called_once()
    def test_bounded_startup_failures(self):
        a={'url':'https://example.com','profile':'temporary','confirm':True,'graphical':True}
        for err,expected in [(RuntimeError('Chromium startup timed out'),'Chromium startup timed out'),(RuntimeError('fixture-private-value'),'Chromium startup failed')]:
            with patch.object(c,'_ensure',side_effect=err):
                self.assertEqual(c.METHODS['viewer_open'](a,{'user':'A'})['error'],expected)

    def test_startup_error_classifier(self):
        for data,expected in [
            ('FATAL: No usable sandbox! private value','Chromium sandbox initialization failed'),
            ('ERROR: Missing X server or $DISPLAY','Chromium could not connect to its graphical display'),
            ('error while loading shared libraries: private.so','Chromium system dependency unavailable'),
            ('pthread_create: Resource temporarily unavailable','Chromium process resources exhausted'),
            ('Failed to create a ProcessSingleton','Chromium profile initialization failed'),
            ('ordinary DBus warning with private value',None)]:
            self.assertEqual(c._StartupDiagnostics.classify(data),expected)
        for error in c._STARTUP_FAILURES:
            with patch.object(c,'_ensure',side_effect=RuntimeError(error)):
                r=c.METHODS['viewer_open']({'url':'https://example.com','confirm':True},{'user':'A'})
                self.assertEqual(r['error'],error)
