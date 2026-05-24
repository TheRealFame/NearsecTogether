import pyaudio
import sys

CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 48000

p = pyaudio.PyAudio()

# Hunt for the PipeWire virtual cable or a Monitor device
device_index = None
for i in range(p.get_device_count()):
    dev = p.get_device_info_by_index(i)
    name = dev.get('name', '').lower()
    if "nearsecappaudio" in name or "monitor" in name:
        device_index = i
        break

try:
    stream = p.open(format=FORMAT,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    input_device_index=device_index,
                    frames_per_buffer=CHUNK)
    
    while True:
        data = stream.read(CHUNK, exception_on_overflow=False)
        # Dump raw binary audio to Node.js
        sys.stdout.buffer.write(data)
        sys.stdout.flush()

except KeyboardInterrupt:
    pass
except Exception as e:
    sys.stderr.write(f"Audio driver error: {e}\n")
finally:
    if 'stream' in locals():
        stream.stop_stream()
        stream.close()
    p.terminate()
