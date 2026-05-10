import uinput
import time

device = uinput.Device([uinput.BTN_A, uinput.ABS_X + (0, 255, 0, 0)], name="Test Pad")
print("Device created. Check if it exists.")
time.sleep(3)

del device
print("Device deleted. Check if it disappeared.")
time.sleep(3)
