#!/bin/bash

rm -r -f sis
git clone https://github.com/rintaro-s/sis.git
sudo apt remove sis-ui -y
cd sis
chmod +x ./try-deploy.sh
./try-deploy.sh
