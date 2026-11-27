import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import serve_mode


class ServeModeTest(unittest.TestCase):
    def test_mode(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PYLON2_DAEMON_MODE', None)
            self.assertEqual(serve_mode.mode({}), 'client')
            self.assertEqual(serve_mode.mode({'mode': 'client'}), 'client')
            self.assertEqual(serve_mode.mode({'mode': 'passive'}), 'client')
            self.assertEqual(serve_mode.mode({'mode': 'standalone'}), 'client')
            self.assertEqual(serve_mode.mode({'mode': 'server'}), 'server')
            self.assertEqual(serve_mode.mode({'mode': 'full'}), 'server')
            with patch.dict(os.environ, {'PYLON2_DAEMON_MODE': 'client'}):
                self.assertEqual(serve_mode.mode({'mode': 'server'}), 'client')     # env wins
            with self.assertRaises(SystemExit):
                serve_mode.mode({'mode': 'bogus'})

    def test_passive_url_and_token(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ, {}, clear=False):
            for k in ('PYLON2_DAEMON_MODE', 'PYLON2_FRAMEWORK_URL', 'PYLON2_AGENT_TOKEN'):
                os.environ.pop(k, None)
            tok = Path(d) / 'agent-token'
            tok.write_text('file-token\n')
            url, headers, server = serve_mode.setup({'framework_url': 'wss://h/x/agent', 'agent_token_file': str(tok)},
                                                    'ws://default/agent')
            self.assertEqual((url, headers, server), ('wss://h/x/agent', {'Authorization': 'Bearer file-token'}, None))
            with patch.dict(os.environ, {'PYLON2_AGENT_TOKEN': 'env-token', 'PYLON2_FRAMEWORK_URL': 'ws://e/agent'}):
                url, headers, _ = serve_mode.setup({'agent_token_file': str(tok)}, 'ws://default/agent')
                self.assertEqual((url, headers), ('ws://e/agent', {'Authorization': 'Bearer env-token'}))
            url, headers, _ = serve_mode.setup({'agent_token_file': str(Path(d) / 'missing')}, 'ws://default/agent')
            self.assertEqual((url, headers), ('ws://default/agent', {}))

    def test_ws_connect_header_argument_across_versions(self):
        calls = []

        def new_api(url, additional_headers=None, **kw):
            calls.append(('additional', additional_headers))

        def legacy_api(url, extra_headers=None, **kw):       # like websockets<=13: swallows unknown kwargs
            calls.append(('extra', extra_headers))
        serve_mode.ws_connect(new_api, 'ws://x', {'A': '1'})
        serve_mode.ws_connect(legacy_api, 'ws://x', {'A': '1'})
        serve_mode.ws_connect(legacy_api, 'ws://x', {})
        self.assertEqual(calls, [('additional', {'A': '1'}), ('extra', {'A': '1'}), ('extra', None)])

    def test_server_env_carries_only_the_token_hash(self):
        s = serve_mode.LocalServer({'server_port': 1, 'server_env': {'X': 1}})
        env = s._env()
        self.assertNotIn(s.token, ''.join(env.values()))
        self.assertEqual(len(env['PYLON_AGENT_TOKEN_SHA256']), 64)
        self.assertEqual(env['X'], '1')

    def test_normalize_framework_url(self):
        self.assertEqual(serve_mode.DEFAULT_CENTRAL_HOST, 'pylon-server.duckdns.org')
        self.assertEqual(serve_mode.DEFAULT_CENTRAL_WS_URL, 'wss://pylon-server.duckdns.org/agent')
        self.assertEqual(serve_mode.normalize_framework_url('pylon-server.duckdns.org'), 'wss://pylon-server.duckdns.org/agent')
        self.assertEqual(serve_mode.normalize_framework_url('https://pylon-server.duckdns.org/'), 'wss://pylon-server.duckdns.org/agent')
        self.assertEqual(serve_mode.normalize_framework_url('127.0.0.1:8910'), 'ws://127.0.0.1:8910/agent')
        self.assertEqual(serve_mode.normalize_framework_url('wss://h/x/agent'), 'wss://h/x/agent')
        with self.assertRaises(ValueError):
            serve_mode.normalize_framework_url('ftp://bad.host')


if __name__ == '__main__':
    unittest.main()
