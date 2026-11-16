// vanity-audio.exe: captures sound for screen sharing in Vanity's voice rooms (Windows 10 2004+).
//
//   vanity-audio.exe exclude <pid>          everything you hear except that program (and what it started)
//   vanity-audio.exe window <hwnd> <pid>    only the sound of the program that owns that window;
//                                           exits with code 3 if that program is <pid> itself
//
// Vanity passes its own process id, so the voices of the people in the call (played by Vanity)
// are never sent back to them. Sound is written to standard output as raw 16-bit stereo PCM at
// 48 kHz, as it arrives. It stops when standard input closes (Vanity stopped it, or quit).
//
// Exit codes: 0 stopped, 1 bad arguments, 2 this Windows can't capture per-program sound,
// 3 the window is Vanity's own, 4 capture failed.
//
// Built by .github/workflows/release.yml with MSVC; also compiles with mingw-w64.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <objidl.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

#if defined(__has_include)
#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#define HAVE_ACTIVATION_PARAMS 1
#endif
#endif

#ifndef HAVE_ACTIVATION_PARAMS
// From audioclientactivationparams.h (Windows SDK 10.0.20348+), for compilers without it.
typedef enum { AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1 } AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1 } PROCESS_LOOPBACK_MODE;
typedef struct {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#endif
#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static const int RATE = 48000;
static const int CHANNELS = 2;
static const int BITS = 16;

// Called by Windows when the audio client is ready. Must be agile (callable from any thread).
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;
  virtual ~ActivateHandler() { CloseHandle(done); }

  STDMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *out = static_cast<IAgileObject*>(this);
    } else {
      *out = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs); }
  STDMETHODIMP_(ULONG) Release() override {
    ULONG n = InterlockedDecrement(&refs);
    if (n == 0) delete this;
    return n;
  }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT activated = E_FAIL;
    IUnknown* unknown = nullptr;
    HRESULT hr = op->GetActivateResult(&activated, &unknown);
    if (SUCCEEDED(hr) && SUCCEEDED(activated) && unknown) {
      hr = unknown->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client));
      result = hr;
    } else {
      result = FAILED(hr) ? hr : activated;
    }
    if (unknown) unknown->Release();
    SetEvent(done);
    return S_OK;
  }

 private:
  LONG refs = 1;
};

static volatile LONG stopping = 0;

// Vanity closes standard input to stop us (and it closes by itself if Vanity goes away).
static DWORD WINAPI WatchStdin(void*) {
  char buf[64];
  DWORD n = 0;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {
  }
  InterlockedExchange(&stopping, 1);
  return 0;
}

static bool WriteAll(HANDLE out, const BYTE* data, DWORD size) {
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(out, data, size, &written, nullptr) || written == 0) return false;
    data += written;
    size -= written;
  }
  return true;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 3) {
    fwprintf(stderr, L"usage: vanity-audio exclude <pid> | window <hwnd> <pid>\n");
    return 1;
  }
  DWORD pid = 0;
  PROCESS_LOOPBACK_MODE mode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  if (wcscmp(argv[1], L"exclude") == 0) {
    pid = static_cast<DWORD>(wcstoul(argv[2], nullptr, 10));
  } else if (wcscmp(argv[1], L"window") == 0 && argc >= 4) {
    HWND hwnd = reinterpret_cast<HWND>(static_cast<ULONG_PTR>(_wcstoui64(argv[2], nullptr, 10)));
    DWORD self = static_cast<DWORD>(wcstoul(argv[3], nullptr, 10));
    if (!IsWindow(hwnd)) {
      fwprintf(stderr, L"window is gone\n");
      return 4;
    }
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == self) return 3;
    mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  } else {
    return 1;
  }
  if (pid == 0) return 1;

  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 4;

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;
  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof(params);
  prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivateHandler* handler = new ActivateHandler();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &prop, handler, &op);
  if (FAILED(hr)) {
    fwprintf(stderr, L"activate failed: 0x%08lx\n", static_cast<unsigned long>(hr));
    return 2;
  }
  if (WaitForSingleObject(handler->done, 5000) != WAIT_OBJECT_0 || FAILED(handler->result) || !handler->client) {
    fwprintf(stderr, L"activate result: 0x%08lx\n", static_cast<unsigned long>(handler->result));
    return 2;
  }
  IAudioClient* client = handler->client;
  if (op) op->Release();

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = CHANNELS;
  format.nSamplesPerSec = RATE;
  format.wBitsPerSample = BITS;
  format.nBlockAlign = CHANNELS * BITS / 8;
  format.nAvgBytesPerSec = RATE * format.nBlockAlign;

  // A 20 ms buffer, handed over as soon as each packet is ready (low delay).
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, 200000, 0, &format, nullptr);
  if (FAILED(hr)) {
    fwprintf(stderr, L"initialize failed: 0x%08lx\n", static_cast<unsigned long>(hr));
    return 4;
  }
  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  IAudioCaptureClient* capture = nullptr;
  if (FAILED(client->SetEventHandle(ready)) || FAILED(client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture)))) return 4;

  _setmode(_fileno(stdout), _O_BINARY);
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  CreateThread(nullptr, 0, WatchStdin, nullptr, 0, nullptr);
  if (FAILED(client->Start())) return 4;
  fwprintf(stderr, L"ready\n");
  fflush(stderr);

  // Big enough for one packet of silence.
  static BYTE zeros[RATE / 10 * CHANNELS * BITS / 8] = {};
  int code = 0;
  while (!stopping) {
    // Nothing arrives while nothing plays: wake up now and then to notice being stopped.
    if (WaitForSingleObject(ready, 200) != WAIT_OBJECT_0) continue;
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) {
        code = 4;
        break;
      }
      DWORD bytes = frames * format.nBlockAlign;
      bool ok;
      if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) && bytes <= sizeof zeros) ok = WriteAll(out, zeros, bytes);
      else ok = WriteAll(out, data, bytes);
      capture->ReleaseBuffer(frames);
      if (!ok) {
        // Vanity stopped reading.
        InterlockedExchange(&stopping, 1);
        break;
      }
    }
    if (code) break;
  }
  client->Stop();
  capture->Release();
  client->Release();
  CoUninitialize();
  return code;
}
