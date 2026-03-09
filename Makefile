PACKAGE_NAME = aerogel
PACKAGE_DIR  = package

.PHONY: build install reinstall uninstall clean

## Compile TypeScript → package/contents/code/main.js
build:
	npm run build

## Build then install the KWin script package
install: build
	kpackagetool6 --type=KWin/Script --install=$(PACKAGE_DIR) || \
	kpackagetool6 --type=KWin/Script --upgrade=$(PACKAGE_DIR)

## Alias: reinstall = upgrade
reinstall: build
	kpackagetool6 --type=KWin/Script --upgrade=$(PACKAGE_DIR)

## Remove the installed KWin script package
uninstall:
	kpackagetool6 --type=KWin/Script --remove=$(PACKAGE_NAME)

## Remove compiled output
clean:
	rm -f $(PACKAGE_DIR)/contents/code/main.js
