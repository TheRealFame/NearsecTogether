#include <napi.h>
#include <linux/uinput.h>
#include <linux/input.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <iostream>
#include <map>

// Wrapped in a namespace to match the scoped PKT:: calls perfectly
namespace PKT {
    enum {
        GAMEPAD   = 0x01, MOUSE_REL = 0x02, MOUSE_ABS = 0x03, MOUSE_BTN = 0x04,
        WHEEL     = 0x05, KEY       = 0x06, ALLOC_GP  = 0x10, FREE_GP   = 0x11,
        FLUSH     = 0x20, DESTROY   = 0xFF
    };
}

// Match the JS W3C Button Mask
enum W3C_BTN {
    A = 1<<0, B = 1<<1, Y = 1<<2, X = 1<<3, LB = 1<<4, RB = 1<<5,
    BACK = 1<<8, START = 1<<9, LS = 1<<10, RS = 1<<11, GUIDE = 1<<16
};

// Global File Descriptors
int kbm_fd = -1;
std::map<uint8_t, int> gp_fds;

// Helper to write kernel events and safely handle the write results to satisfy GCC
void emit(int fd, uint16_t type, uint16_t code, int32_t val) {
    if (fd < 0) return;
    struct input_event ie = {};
    ie.type = type;
    ie.code = code;
    ie.value = val;
    if (write(fd, &ie, sizeof(ie)) < 0) {
        // Kernel buffer full or device closed; safely drop to avoid crashing the fast-lane
    }
}
void syn(int fd) { emit(fd, EV_SYN, SYN_REPORT, 0); }

// ── N-API INIT MOUSE/KEYBOARD ──
Napi::Boolean InitializeDevice(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int screenW = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 1920;
    int screenH = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 1080;

    kbm_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (kbm_fd < 0) return Napi::Boolean::New(env, false);

    // Setup Keyboard
    ioctl(kbm_fd, UI_SET_EVBIT, EV_KEY);
    for (int i = 1; i < 255; i++) ioctl(kbm_fd, UI_SET_KEYBIT, i);

    // Setup Mouse
    ioctl(kbm_fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(kbm_fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(kbm_fd, UI_SET_KEYBIT, BTN_MIDDLE);

    ioctl(kbm_fd, UI_SET_EVBIT, EV_REL);
    ioctl(kbm_fd, UI_SET_RELBIT, REL_X);
    ioctl(kbm_fd, UI_SET_RELBIT, REL_Y);
    ioctl(kbm_fd, UI_SET_RELBIT, REL_WHEEL);
    ioctl(kbm_fd, UI_SET_RELBIT, REL_HWHEEL);

    ioctl(kbm_fd, UI_SET_EVBIT, EV_ABS);
    ioctl(kbm_fd, UI_SET_ABSBIT, ABS_X);
    ioctl(kbm_fd, UI_SET_ABSBIT, ABS_Y);

    struct uinput_user_dev uud = {};
    snprintf(uud.name, UINPUT_MAX_NAME_SIZE, "Nearsec Virtual KBM");
    uud.id.bustype = BUS_USB;
    uud.id.vendor  = 0x1234;
    uud.id.product = 0x5678;
    uud.id.version = 1;
    uud.absmax[ABS_X] = screenW;
    uud.absmax[ABS_Y] = screenH;

    if (write(kbm_fd, &uud, sizeof(uud)) < 0) {
        close(kbm_fd);
        kbm_fd = -1;
        return Napi::Boolean::New(env, false);
    }
    ioctl(kbm_fd, UI_DEV_CREATE);

    return Napi::Boolean::New(env, true);
}

// ── FAST LANE BINARY ROUTER ──
Napi::Value SubmitInputPacket(const Napi::CallbackInfo& info) {
    if (!info[0].IsBuffer()) return info.Env().Undefined();

    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    uint8_t* data = buffer.Data();
    if (buffer.Length() < 1) return info.Env().Undefined();

    uint8_t type = data[0];

    switch (type) {
        case PKT::GAMEPAD: {
            uint8_t slot = data[15];
            if (gp_fds.find(slot) == gp_fds.end()) break;
            int fd = gp_fds[slot];

            // Extract bytes based on JS Buffer
            int16_t lx = *reinterpret_cast<int16_t*>(&data[1]);
            int16_t ly = *reinterpret_cast<int16_t*>(&data[3]);
            int16_t rx = *reinterpret_cast<int16_t*>(&data[5]);
            int16_t ry = *reinterpret_cast<int16_t*>(&data[7]);
            uint8_t lt = data[9];
            uint8_t rt = data[10];
            uint16_t btn = *reinterpret_cast<uint16_t*>(&data[11]);
            int8_t hx = *reinterpret_cast<int8_t*>(&data[13]);
            int8_t hy = *reinterpret_cast<int8_t*>(&data[14]);

            // Axes
            emit(fd, EV_ABS, ABS_X, lx);
            emit(fd, EV_ABS, ABS_Y, ly);
            emit(fd, EV_ABS, ABS_RX, rx);
            emit(fd, EV_ABS, ABS_RY, ry);
            emit(fd, EV_ABS, ABS_Z, lt);
            emit(fd, EV_ABS, ABS_RZ, rt);
            emit(fd, EV_ABS, ABS_HAT0X, hx);
            emit(fd, EV_ABS, ABS_HAT0Y, hy);

            // Buttons
            emit(fd, EV_KEY, BTN_SOUTH,  (btn & W3C_BTN::A) ? 1 : 0);
            emit(fd, EV_KEY, BTN_EAST,   (btn & W3C_BTN::B) ? 1 : 0);
            emit(fd, EV_KEY, BTN_WEST,   (btn & W3C_BTN::Y) ? 1 : 0);
            emit(fd, EV_KEY, BTN_NORTH,  (btn & W3C_BTN::X) ? 1 : 0);
            emit(fd, EV_KEY, BTN_TL,     (btn & W3C_BTN::LB) ? 1 : 0);
            emit(fd, EV_KEY, BTN_TR,     (btn & W3C_BTN::RB) ? 1 : 0);
            emit(fd, EV_KEY, BTN_SELECT, (btn & W3C_BTN::BACK) ? 1 : 0);
            emit(fd, EV_KEY, BTN_START,  (btn & W3C_BTN::START) ? 1 : 0);
            emit(fd, EV_KEY, BTN_THUMBL, (btn & W3C_BTN::LS) ? 1 : 0);
            emit(fd, EV_KEY, BTN_THUMBR, (btn & W3C_BTN::RS) ? 1 : 0);
            emit(fd, EV_KEY, BTN_MODE,   (btn & W3C_BTN::GUIDE) ? 1 : 0);

            syn(fd);
            break;
        }
        case PKT::MOUSE_REL: {
            int16_t dx = *reinterpret_cast<int16_t*>(&data[1]);
            int16_t dy = *reinterpret_cast<int16_t*>(&data[3]);
            emit(kbm_fd, EV_REL, REL_X, dx);
            emit(kbm_fd, EV_REL, REL_Y, dy);
            syn(kbm_fd);
            break;
        }
        case PKT::MOUSE_ABS: {
            uint16_t nx = *reinterpret_cast<uint16_t*>(&data[1]);
            uint16_t ny = *reinterpret_cast<uint16_t*>(&data[3]);
            emit(kbm_fd, EV_ABS, ABS_X, nx);
            emit(kbm_fd, EV_ABS, ABS_Y, ny);
            syn(kbm_fd);
            break;
        }
        case PKT::MOUSE_BTN: {
            uint8_t btns = data[1];
            uint8_t down = data[2];
            if (btns & 0x01) emit(kbm_fd, EV_KEY, BTN_LEFT, down);
            if (btns & 0x02) emit(kbm_fd, EV_KEY, BTN_RIGHT, down);
            if (btns & 0x04) emit(kbm_fd, EV_KEY, BTN_MIDDLE, down);
            syn(kbm_fd);
            break;
        }
        case PKT::WHEEL: {
            int16_t dy = *reinterpret_cast<int16_t*>(&data[1]);
            int16_t dx = *reinterpret_cast<int16_t*>(&data[3]);
            emit(kbm_fd, EV_REL, REL_WHEEL, dy / 120);
            emit(kbm_fd, EV_REL, REL_HWHEEL, dx / 120);
            syn(kbm_fd);
            break;
        }
        case PKT::KEY: {
            uint16_t code = *reinterpret_cast<uint16_t*>(&data[1]);
            uint8_t down = data[3];
            emit(kbm_fd, EV_KEY, code, down);
            syn(kbm_fd);
            break;
        }
        case PKT::ALLOC_GP: {
            uint8_t slot = data[1];
            uint16_t vid = *reinterpret_cast<uint16_t*>(&data[2]);
            uint16_t pid = *reinterpret_cast<uint16_t*>(&data[4]);
            uint16_t ver = *reinterpret_cast<uint16_t*>(&data[6]);

            int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
            if (fd < 0) break;

            ioctl(fd, UI_SET_EVBIT, EV_KEY);
            ioctl(fd, UI_SET_KEYBIT, BTN_SOUTH); ioctl(fd, UI_SET_KEYBIT, BTN_EAST);
            ioctl(fd, UI_SET_KEYBIT, BTN_NORTH); ioctl(fd, UI_SET_KEYBIT, BTN_WEST);
            ioctl(fd, UI_SET_KEYBIT, BTN_TL);    ioctl(fd, UI_SET_KEYBIT, BTN_TR);
            ioctl(fd, UI_SET_KEYBIT, BTN_SELECT);ioctl(fd, UI_SET_KEYBIT, BTN_START);
            ioctl(fd, UI_SET_KEYBIT, BTN_MODE);
            ioctl(fd, UI_SET_KEYBIT, BTN_THUMBL);ioctl(fd, UI_SET_KEYBIT, BTN_THUMBR);

            ioctl(fd, UI_SET_EVBIT, EV_ABS);
            struct uinput_user_dev uud = {};

            uud.absmin[ABS_X] = -32768; uud.absmax[ABS_X] = 32767; ioctl(fd, UI_SET_ABSBIT, ABS_X);
            uud.absmin[ABS_Y] = -32768; uud.absmax[ABS_Y] = 32767; ioctl(fd, UI_SET_ABSBIT, ABS_Y);
            uud.absmin[ABS_RX]= -32768; uud.absmax[ABS_RX]= 32767; ioctl(fd, UI_SET_ABSBIT, ABS_RX);
            uud.absmin[ABS_RY]= -32768; uud.absmax[ABS_RY]= 32767; ioctl(fd, UI_SET_ABSBIT, ABS_RY);
            uud.absmin[ABS_Z] = 0;      uud.absmax[ABS_Z] = 255;   ioctl(fd, UI_SET_ABSBIT, ABS_Z);
            uud.absmin[ABS_RZ]= 0;      uud.absmax[ABS_RZ]= 255;   ioctl(fd, UI_SET_ABSBIT, ABS_RZ);
            uud.absmin[ABS_HAT0X] = -1; uud.absmax[ABS_HAT0X] = 1; ioctl(fd, UI_SET_ABSBIT, ABS_HAT0X);
            uud.absmin[ABS_HAT0Y] = -1; uud.absmax[ABS_HAT0Y] = 1; ioctl(fd, UI_SET_ABSBIT, ABS_HAT0Y);

            uud.id.bustype = BUS_USB;
            uud.id.vendor = vid; uud.id.product = pid; uud.id.version = ver;
            memcpy(uud.name, &data[8], 32);

            if (write(fd, &uud, sizeof(uud)) < 0) {
                close(fd);
                break;
            }
            ioctl(fd, UI_DEV_CREATE);
            gp_fds[slot] = fd;
            break;
        }
        case PKT::FREE_GP: {
            uint8_t slot = data[1];
            if (gp_fds.find(slot) != gp_fds.end()) {
                ioctl(gp_fds[slot], UI_DEV_DESTROY);
                close(gp_fds[slot]);
                gp_fds.erase(slot);
            }
            break;
        }
        case PKT::FLUSH: {
            uint8_t slot = data[1];
            if (gp_fds.find(slot) == gp_fds.end()) break;
            int fd = gp_fds[slot];
            // Neutralize axes
            emit(fd, EV_ABS, ABS_X, 0); emit(fd, EV_ABS, ABS_Y, 0);
            emit(fd, EV_ABS, ABS_RX, 0); emit(fd, EV_ABS, ABS_RY, 0);
            emit(fd, EV_ABS, ABS_Z, 0); emit(fd, EV_ABS, ABS_RZ, 0);
            emit(fd, EV_ABS, ABS_HAT0X, 0); emit(fd, EV_ABS, ABS_HAT0Y, 0);
            // Neutralize buttons
            for (auto code : {BTN_SOUTH, BTN_EAST, BTN_WEST, BTN_NORTH, BTN_TL, BTN_TR, BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR}) {
                emit(fd, EV_KEY, code, 0);
            }
            syn(fd);
            break;
        }
        case PKT::DESTROY: {
            for (auto& pair : gp_fds) {
                ioctl(pair.second, UI_DEV_DESTROY);
                close(pair.second);
            }
            gp_fds.clear();
            if (kbm_fd >= 0) {
                ioctl(kbm_fd, UI_DEV_DESTROY);
                close(kbm_fd);
                kbm_fd = -1;
            }
            break;
        }
    }
    return info.Env().Undefined();
}

Napi::Value DestroyDevice(const Napi::CallbackInfo& info) {
    if (kbm_fd >= 0) { ioctl(kbm_fd, UI_DEV_DESTROY); close(kbm_fd); kbm_fd = -1; }
    for (auto& pair : gp_fds) { ioctl(pair.second, UI_DEV_DESTROY); close(pair.second); }
    gp_fds.clear();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "initializeDevice"), Napi::Function::New(env, InitializeDevice));
    exports.Set(Napi::String::New(env, "submitInputPacket"), Napi::Function::New(env, SubmitInputPacket));
    exports.Set(Napi::String::New(env, "destroyDevice"), Napi::Function::New(env, DestroyDevice));
    return exports;
}

NODE_API_MODULE(uinputBridge, Init)
