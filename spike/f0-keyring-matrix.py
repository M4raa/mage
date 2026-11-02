"""F0.5c: bus privado, llavero desechable y watchdog FUERA del hilo Electron."""
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import time


def emit(**value):
    print(json.dumps(value), flush=True)


def bus_call(destination, object_path, method, *args):
    command = ['dbus-send', '--session', '--print-reply', '--reply-timeout=1500',
               '--dest=' + destination, object_path, method, *args]
    return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT, timeout=2)


def owner():
    reply = bus_call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                     'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.secrets')
    return 'boolean true' in reply


def collection():
    reply = bus_call('org.freedesktop.secrets', '/org/freedesktop/secrets',
                     'org.freedesktop.Secret.Service.ReadAlias', 'string:default')
    found = re.search(r'object path "([^"]+)"', reply)
    if not found or found[1] == '/':
        raise RuntimeError('No hay colección por defecto: ' + reply)
    return found[1]


def locked(object_path):
    reply = bus_call('org.freedesktop.secrets', object_path,
                     'org.freedesktop.DBus.Properties.Get',
                     'string:org.freedesktop.Secret.Collection', 'string:Locked')
    return 'boolean true' in reply


def probe(action):
    command = [os.environ['MAGE_ELECTRON'], '--disable-gpu', '--ozone-platform=headless',
               '--password-store=gnome-libsecret', os.environ['MAGE_PROBE']]
    began = time.monotonic()
    child = subprocess.Popen(command, env={**os.environ, 'MAGE_F0_ACTION': action},
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = child.communicate(timeout=6)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGKILL)
        stdout, stderr = child.communicate()
    emit(phase='supervisor', action=action, elapsedMs=(time.monotonic() - began) * 1000,
         timeoutMs=6000, timedOut=timed_out, exit=child.returncode)
    print(stdout, end='', flush=True)
    if stderr:
        print(stderr, end='', flush=True)
    return not timed_out and child.returncode == 0 and '"phase":"call-end","name":"fixture"' in stdout


def prepare_locked():
    for _ in range(30):
        if owner():
            break
        time.sleep(0.05)
    object_path = collection()
    if locked(object_path):
        raise RuntimeError('La colección sintética debía estar desbloqueada inicialmente')
    if not probe('fixture') or not Path(os.environ['MAGE_F0_CIPHER']).is_file():
        raise RuntimeError('No se creó la muestra cifrada de control')
    os.environ['MAGE_F0_COLLECTION'] = object_path
    probe('warm-lock')
    if not locked(object_path):
        raise RuntimeError('No se consiguió bloquear la colección')
    emit(phase='locked-confirmed', collection=object_path, locked=True)
    return object_path


def main():
    state = os.environ['MAGE_KEYRING_STATE']
    monitor = subprocess.Popen(['dbus-monitor', '--session',
        "type='method_call',interface='org.freedesktop.Secret.Prompt',member='Prompt'"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) if shutil.which('dbus-monitor') else None
    daemon = None
    try:
        emit(phase='case', state=state, uid=os.getuid(), installed=True, secretServiceOwner=owner())
        if state == 'locked':
            daemon = subprocess.Popen(['gnome-keyring-daemon', '--foreground', '--unlock', '--components=secrets',
                '--control-directory=' + os.environ['XDG_RUNTIME_DIR'] + '/keyring'],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
            daemon.stdin.write('F0.5c-disposable-password')
            daemon.stdin.close()
            time.sleep(0.2)
        object_path = prepare_locked() if state == 'locked' else None
        if object_path is None:
            if owner():
                raise RuntimeError('Caso sin daemon contaminado por un servicio activo')
            # Cifrado auténtico del control desechable; no una cadena inválida que falle al parsear.
            shutil.copyfile(os.environ['MAGE_F0_CIPHER_SEED'], os.environ['MAGE_F0_CIPHER'])
        for action in ('availability', 'encrypt', 'decrypt'):
            probe(action)
            emit(phase='state-after', action=action, secretServiceOwner=owner(),
                 locked=locked(object_path) if object_path else None)
    finally:
        if daemon is not None:
            daemon.terminate()
            daemon.wait(timeout=3)
        if monitor is not None:
            monitor.terminate()
            stdout, _ = monitor.communicate(timeout=2)
            emit(phase='unlock-prompts', calls=stdout.count('member=Prompt'))
        else:
            emit(phase='unlock-prompts', monitorUnavailable=True)


if __name__ == '__main__':
    main()
