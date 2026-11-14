#!/usr/bin/env python3
"""Deja sobres cifrados en el buzón de Hilo (para tareas programadas: radar de oportunidades, correo, noticias).

Cifrado de punta a punta: cada dispositivo de la persona publicó su clave pública RSA-OAEP en el Worker.
Este script cifra cada elemento para cada dispositivo (AES-256-GCM con clave de un solo uso, envuelta con RSA-OAEP-256)
y el Worker solo guarda texto opaco. El token solo sirve para escribir en ese buzón; no permite leer nada.

Uso:
  HILO_BUZON_TOKEN=... python3 buzon.py elementos.json
  elementos.json = [{"type":"oportunidad"|"correo"|"noticia"|"agenda","title":"...","summary":"...","url":"https://...","next":"...","due":"AAAA-MM-DD","tema":"..."}]
  (agenda: "title" = "10:00 · Qué" y "due" = el día; solo se muestra en el parte, no crea asuntos)
  Cada elemento lleva una referencia «ref» (se calcula sola) que se imprime al enviar: anótala para cruzarla con las respuestas.
  HILO_BUZON_TOKEN=... python3 buzon.py --respuestas
  imprime en JSON lo que la persona decidió en Hilo (aceptado / hecho / descartado y motivo) en los últimos 45 días.
  Los motivos de descarte son: lejos, sueldo, requisitos, puesto (no le interesa el puesto), ya (ya postuló / ya lo tenía), otro.
Requiere: pip install cryptography
"""
import base64, json, os, sys, urllib.request
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

URL = os.environ.get('HILO_BUZON_URL', 'https://hilo-ia.hilo-ia.workers.dev')
AAD = b'hilo-buzon-v1'
TYPES = {'oportunidad', 'correo', 'noticia', 'agenda'}
import hashlib
LIMITS = {'title': 140, 'summary': 480, 'next': 240, 'tema': 40}


def b64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def pubkey(jwk):
    n = int.from_bytes(b64u(jwk['n']), 'big')
    e = int.from_bytes(b64u(jwk['e']), 'big')
    return rsa.RSAPublicNumbers(e, n).public_key()


def seal(pub, obj):
    key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode('utf-8'), AAD)
    ek = pub.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    b = lambda x: base64.b64encode(x).decode()
    return f'{b(ek)}.{b(iv)}.{b(ct)}'


def clean(it):
    if not isinstance(it, dict) or it.get('type') not in TYPES or not str(it.get('title', '')).strip():
        return None
    out = {'type': it['type']}
    for k, n in LIMITS.items():
        if it.get(k):
            out[k] = str(it[k]).strip()[:n]
    url = str(it.get('url', ''))
    if url.startswith('https://') and len(url) <= 600 and not any(c in url for c in ' "\'<>'):
        out['url'] = url
    due = str(it.get('due', ''))
    if len(due) == 10 and due[4] == '-' and due[7] == '-':
        out['due'] = due
    out['ref'] = hashlib.sha256((out['type'] + '|' + (out.get('url') or out['title'])).encode('utf-8')).hexdigest()[:12]
    return out


def call(path, token, body=None):
    req = urllib.request.Request(URL + path, method='POST' if body is not None else 'GET',
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'hilo-buzon/1.0'},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    token = os.environ.get('HILO_BUZON_TOKEN', '')
    if len(token) < 24:
        sys.exit('Falta HILO_BUZON_TOKEN')
    if sys.argv[1:2] == ['--respuestas']:
        print(json.dumps(call('/inbox/fb', token).get('items', []), ensure_ascii=False, indent=1)); return
    items = [x for x in (clean(i) for i in json.load(open(sys.argv[1], encoding='utf-8'))) if x][:20]
    if not items:
        print('Nada para enviar'); return
    keys = call('/inbox/keys', token).get('keys', [])
    if not keys:
        sys.exit('Ningún dispositivo registró su clave todavía (abrir Hilo con el asistente configurado).')
    sobres = [{'device': k['device'], 'blob': seal(pubkey(k['pub']), it)} for k in keys for it in items]
    total, last = 0, len(range(0, len(sobres), 50)) - 1
    avisar = any(it['type'] in ('oportunidad', 'correo') for it in items)  # noticias y agenda no hacen sonar el móvil
    for n, i in enumerate(range(0, len(sobres), 50)):
        total += call('/inbox/put', token, {'items': sobres[i:i + 50], 'notify': avisar and n == last}).get('stored', 0)
    print(f'Enviados {len(items)} elementos a {len(keys)} dispositivo(s): {total} sobres guardados.')
    for it in items:
        print(f"ref {it['ref']} · {it['type']} · {it['title']}")


if __name__ == '__main__':
    main()
