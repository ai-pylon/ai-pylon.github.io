"""Linux endpoint for the existing JSON/WebSocket protocol (docs/PROTOCOL.md)."""
from __future__ import annotations

import asyncio
import getpass
import importlib
import json
import logging
import os
import pkgutil
import random
import signal
import socket
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from logging_bridge import Relay
import serve_mode  # pylon-server: passive runner or bootstrap of a local server
import status_http  # lightweight loopback daemon status dashboard

LOG = logging.getLogger('pylon-linux')


def discover():
    import caps
    found = {}
    for info in pkgutil.iter_modules(caps.__path__):
        if info.name.startswith('_'):
            continue
        module = importlib.import_module('caps.' + info.name)
        found[module.CAPABILITY] = module
    return found


def registration(endpoint, providers):
    meta = {'version': '1', 'user': getpass.getuser(), 'hostname': socket.gethostname()}
    # PYLON2_ENDPOINT_SCOPE=personal declares a RESERVED endpoint: the framework never picks it implicitly for a cap
    # call (only with an explicit hint), whatever its id is - a renamed VM stays reserved (framework/registry._reserved).
    scope = (os.environ.get('PYLON2_ENDPOINT_SCOPE') or '').strip()
    if scope:
        meta['scope'] = scope
        if scope != 'shared':
            meta['reserved'] = True
    return {'type': 'register', 'endpoint': endpoint, 'platform': 'linux',
            'capabilities': [{'name': name, 'variant': 'linux', 'attrs': {'linux': True}}
                             for name in providers] + [{'name': 'cap:_daemon', 'attrs': {'introspection': True}}],
            'meta': meta}


async def dispatch(message, providers, endpoint):
    response = {'type': 'result', 'id': message.get('id')}
    try:
        cap, method = message.get('cap'), message.get('method')
        if cap == 'cap:_daemon' and method in ('versions', 'list_caps'):
            result = {'ok': True, 'endpoint': endpoint, 'pid': os.getpid(),
                      'caps': {name: {'methods': sorted(module.METHODS),
                                      'mtime': Path(module.__file__).stat().st_mtime}
                               for name, module in providers.items()}}
        else:
            provider = providers.get(cap)
            if provider is None or method not in provider.METHODS:
                raise ValueError('Capability or method not provided on this Linux endpoint')
            result = await asyncio.to_thread(provider.METHODS[method], message.get('args') or {}, message.get('ctx') or {})
        if isinstance(result, dict) and result.get('ok') is False:
            return dict(response, ok=False, error=result.get('error', 'Capability failed'),
                        error_category=result.get('error_category', 'application'))
        return dict(response, ok=True, result=result)
    except Exception as exc:
        return dict(response, ok=False, error=str(exc), error_category='application')


async def serve(ws, providers, endpoint):
    await ws.send(json.dumps(registration(endpoint, providers)))
    ack = json.loads(await asyncio.wait_for(ws.recv(), 15))
    if ack.get('type') != 'registered':
        raise ValueError('Framework did not accept registration')
    LOG.info('Registered %s (%s capabilities)', endpoint, len(providers))
    tasks = set()
    limit = asyncio.Semaphore(8)

    async def heartbeat():
        while True:
            await asyncio.sleep(max(1, int(ack.get('heartbeat_interval', 30))))
            await ws.send(json.dumps({'type': 'heartbeat', 'endpoint': endpoint}))

    async def invoke(message):
        async with limit:
            await ws.send(json.dumps(await dispatch(message, providers, endpoint)))

    relay = asyncio.create_task(Relay().run(ws))
    hb = asyncio.create_task(heartbeat())
    try:
        async for raw in ws:
            try:
                message = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(message, dict) or message.get('type') != 'invoke':
                continue
            if len(tasks) >= 32:
                await ws.send(json.dumps({'type': 'result', 'id': message.get('id'), 'ok': False,
                                          'error': 'Linux endpoint is busy', 'error_category': 'unavailable'}))
                continue
            task = asyncio.create_task(invoke(message))
            tasks.add(task)
            def finished(done):
                tasks.discard(done)
                if not done.cancelled():
                    done.exception()
            task.add_done_callback(finished)
    finally:
        hb.cancel()
        relay.cancel()
        for task in list(tasks):
            task.cancel()
        await asyncio.gather(hb, relay, *tasks, return_exceptions=True)


async def main():
    from websockets.asyncio.client import connect
    cfg = {}
    cfg_path = Path(__file__).resolve().parent / 'config.json'
    if cfg_path.is_file():
        cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
    url, headers, server = serve_mode.setup(cfg, serve_mode.DEFAULT_CENTRAL_WS_URL, log=LOG.info)
    daemon_mode = serve_mode.mode(cfg)
    saved_client = serve_mode.load_client_config() if daemon_mode == 'client' else {}
    endpoint = os.environ.get('PYLON2_ENDPOINT_ID') or saved_client.get('endpoint_id') or ('linux-' + socket.gethostname())
    providers = discover()
    conn_target = {'url': url, 'headers': headers, 'endpoint': endpoint}
    loop = asyncio.get_running_loop()
    reconnect_ev = asyncio.Event()
    active_ws = {'ws': None}

    def _on_client_update(new_url, new_headers, new_endpoint):
        conn_target['url'] = new_url
        conn_target['headers'] = new_headers
        if new_endpoint:
            conn_target['endpoint'] = new_endpoint
        LOG.info('Central server updated -> %s; reconnecting', new_url)
        def _trigger():
            reconnect_ev.set()
            ws = active_ws.get('ws')
            if ws is not None:
                asyncio.create_task(ws.close())
        loop.call_soon_threadsafe(_trigger)

    status_state = status_http.DaemonStatusState(
        endpoint=endpoint,
        platform='linux',
        mode=daemon_mode,
        framework_url=url,
    )
    status_srv = status_http.DaemonStatusServer(
        status_state,
        capabilities_fn=lambda: [
            {'name': name, 'methods': sorted(mod.METHODS)}
            for name, mod in sorted(providers.items())
        ],
        server=server,
        port=status_http.resolve_status_port(cfg, daemon_mode=daemon_mode, default_port=18772),
        on_client_config_update=_on_client_update if daemon_mode == 'client' else None,
        log=LOG.info,
    ).start()
    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    delay = 1
    try:
        while not stop.is_set():
            reconnect_ev.clear()
            started = time.monotonic()
            cur_url = conn_target['url']
            cur_headers = conn_target['headers']
            cur_ep = conn_target['endpoint']
            try:
                async with serve_mode.ws_connect(connect, cur_url, cur_headers, proxy=None, open_timeout=10,
                                                 max_size=4 * 1024 * 1024) as ws:
                    active_ws['ws'] = ws
                    status_state.set_connected(cur_url)
                    channel = asyncio.create_task(serve(ws, providers, cur_ep))
                    stopping = asyncio.create_task(stop.wait())
                    try:
                        await asyncio.wait([channel, stopping], return_when=asyncio.FIRST_COMPLETED)
                        if channel.done():
                            await channel
                    finally:
                        active_ws['ws'] = None
                        status_state.set_disconnected()
                        channel.cancel(); stopping.cancel()
                        await asyncio.gather(channel, stopping, return_exceptions=True)
            except Exception as exc:
                active_ws['ws'] = None
                status_state.set_disconnected(f'{type(exc).__name__}: {exc}')
                LOG.warning('Channel unavailable (%s); reconnecting', type(exc).__name__)
            if reconnect_ev.is_set():
                delay = 1
                continue
            delay = 1 if time.monotonic() - started > 15 else min(delay * 2, 30)
            wait_stop = asyncio.create_task(stop.wait())
            wait_reconn = asyncio.create_task(reconnect_ev.wait())
            try:
                await asyncio.wait([wait_stop, wait_reconn], timeout=delay + random.random(), return_when=asyncio.FIRST_COMPLETED)
            finally:
                wait_stop.cancel(); wait_reconn.cancel()
                await asyncio.gather(wait_stop, wait_reconn, return_exceptions=True)
    finally:
        status_srv.stop()
        for provider in providers.values():
            if hasattr(provider, 'shutdown'):
                await asyncio.to_thread(provider.shutdown)
        if server:
            await asyncio.to_thread(server.stop)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    asyncio.run(main())
