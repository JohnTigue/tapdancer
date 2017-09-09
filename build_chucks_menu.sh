#!/usr/bin/env bash

# This is simply to set up PATH so that cron can run the chucks_parser.js to build a new menu in html (and scrape chuckscd.com)

PATH=/usr/local/aws/bin:/Library/Frameworks/Python.framework/Versions/3.4/bin:/Users/john/.rbenv/bin:/Users/john/.nvm/v6.10.0/bin:/bin:./node_modules/.bin:/usr/local/opt/ruby/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/X11/bin:/Users/john/.bash_it/plugins/available/todo:/Applications/Postgres.app/Contents/Versions/9.4/bin

#echo $PATH >~/stdout.log

cd ~/jft/gits/brew_picker
node chucks_parser.js >~/stdout.log 2>~/stderr.log
