ROOT := ..
HBX ?= /repos/ravensclawx/HBLauncher
CC ?= gcc
CFLAGS += -std=c11 -O2 -Wall -Wextra -Werror -I$(HBX)/sdk/include -I$(ROOT)/src
CORE := $(ROOT)/src/hml_core.c $(ROOT)/src/hml_io.c
MATH := $(HBX)/sdk/src/hbx_math.c

.PHONY: test clean console

test: test-hml app-test
	./test-hml
	./app-test

test-hml: test.c $(CORE) $(MATH)
	$(CC) $(CFLAGS) $^ -lm -o $@

app-test: app_test.c $(ROOT)/src/app.c $(CORE) $(MATH)
	$(CC) $(CFLAGS) -D_POSIX_C_SOURCE=200809L $^ -lm -o $@

console:
	python3 $(HBX)/sdk/tools/hbx-build.py $(ROOT)

clean:
	rm -f test-hml app-test
