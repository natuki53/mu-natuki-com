import importlib.util
from pathlib import Path
import socket
import ssl
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare_monitoring',ROOT/'scripts/prepare-monitoring.py')
prepare=importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class CollectorTLS(unittest.TestCase):
    def test_generated_certificate_passes_strict_verification_and_hostname_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'tls';prepare.certificate_files(root)
            server=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server.load_cert_chain(root/'server.crt',root/'server.key')
            errors=[]
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0));listener.listen();listener.settimeout(5)
                def accept():
                    try:
                        raw,_=listener.accept()
                        with server.wrap_socket(raw,server_side=True) as secure:secure.sendall(b'OK')
                    except Exception as error:errors.append(type(error).__name__)
                thread=threading.Thread(target=accept,daemon=True);thread.start()
                client=ssl.create_default_context(cafile=str(root/'ca.crt'))
                client.verify_flags |= ssl.VERIFY_X509_STRICT
                with socket.create_connection(listener.getsockname(),timeout=5) as raw:
                    with client.wrap_socket(raw,server_hostname='192.168.1.10') as secure:
                        self.assertEqual(secure.recv(2),b'OK')
                thread.join(5)
            self.assertFalse(errors)


if __name__=='__main__':unittest.main()
