(function($){
    
    rir.templates = {
        inbox_layout: chrome.extension.getURL('template/inbox_layout.html'),
        inbox_message_row: chrome.extension.getURL('template/inbox_message_row.html'),
        contact_row: chrome.extension.getURL('template/contact_row.html'),
        conversation: chrome.extension.getURL('template/conversation.html'),
        private_message: chrome.extension.getURL('template/private_message.html'),
        load_more_messages: chrome.extension.getURL('template/load_more_messages.html'),
        load_more_contacts: chrome.extension.getURL('template/load_more_contacts.html'),
        config: chrome.extension.getURL('template/config.html'),
        export_all_window: chrome.extension.getURL('template/export_all_window.html'),
        export_all_to_mysql: chrome.extension.getURL('template/export_all_to_mysql.html'),
        export_all_to_html: chrome.extension.getURL('template/export_all_to_html.html'),
        export_conversation_window: chrome.extension.getURL('template/export_conversation_window.html'),
        export_conversation_to_html: chrome.extension.getURL('template/export_conversation_to_html.html')
    };

    rir.init.funcs.push(rir.functions.DOMReady);
    rir.init.funcs.push(rir.functions.preloadTemplatesReady);

    rir.view = {
        updateContactList: function(conversations){
            var contacts = rir.model.getSortedContactsFromConversations(conversations);
            rir.$e.contacts.find('.rir-contact').remove();
            rir.$e.contacts.find('.rir-load-more').remove();
            rir.view.addContactsToContactList(contacts);
        },
        showConversation: function(conversation){
            // Remove previous contents of main panel
            rir.$e.mainPanel.empty();

            var $conversation = $(rir.templates.conversation).appendTo(rir.$e.mainPanel);
            $conversation.data('conversation', conversation);
            
            var $input = $conversation.find('textarea');
            var $submit = $conversation.find('.rir-conversation-reply-btn');
            var $preview = $conversation.find('.rir-conversation-preview');
            var $messageArea = $conversation.find('.rir-private-messages');
            $conversation.find('.rir-expand-all-btn').on('click', function(){
                $messageArea.find('.rir-private-message').removeClass('rir-collapsed');
            });
            $conversation.find('#RirExportConversation').on('click', rir.view.showExportConversationOptions);
            $conversation.find('.rir-conversation-title').text(conversation.subject);

            var numMessages = conversation.messages.length;
            var responseId = null;
            for(var i = 1; i <= numMessages; i++) {
                (function(pm){
                    var $pm = $(replaceAll(rir.templates.private_message, '{author}', pm.author));
                    $pm.find('.rir-pm-body').html(pm.body_html);
                    $pm.find('.rir-pm-body-short').text(pm.body);
                    $pm.find('.rir-message-date-string').text(longDateString(pm.created_utc));
                    $pm.find('.rir-pm-header').on('click', function(){
                        $pm.toggleClass('rir-collapsed');
                    });
                    $pm.appendTo($messageArea);

                    if(!pm['new'] && i < numMessages) {
                        $pm.addClass('rir-collapsed');
                    }
                    if(pm.author !== getUsername()) {
                        responseId = pm.name;
                    }
                })(conversation.messages[numMessages - i]);
            }
            
            if(!responseId) {
                // You cannot respond unless the other person has said something
                $conversation.find('.rir-conversation-response').remove();
            }
            else {
                $input.on('keyup', function(){
                    $preview.html(rir.markdown.render($input.val()));
                });
                $submit.on('click', function(){
                    var text = $input.val();
                    if(!text.length) {
                        // This should not be an alert
                        alert('You cannot send empty messages!');
                    }
                    else {
                        $input.attr('disabled', 'disabled');
                        rir.view.showLoading("Message is being sent");
                        $.post('/api/comment', {
                            thing_id: responseId,
                            id: '#commentreply_' + responseId,
                            uh: rir.model.uh,
                            text: text,
                            renderstyle: 'html'
                        }).success(function(){
                            rir.model.updateDb(rir.view.update, rir.view.showNotification);
                        });
                    }
                });
            }

            // Hide overlay
            rir.view.hideOverlay();

            // Set conversation status: read
            rir.model.setConversationStatus(conversation, true);
        },
        showInbox: function(conversations, hideOverlay){
            if(typeof hideOverlay !== "boolean") hideOverlay = true;
            
            // Empty panel
            rir.$e.mainPanel.empty();
            
            // Cache the fetched conversations
            rir.model.cache.conversations = conversations;
            rir.view.setFavicon();
            
            // Filter conversations
            var filteredConversations = conversations.slice();
            rir.model.searchFilter(filteredConversations);
            rir.model.directoryFilter(filteredConversations);
            if(!rir.cfg.data.showModmail) rir.model.modmailFilter(filteredConversations);
            
            // Show conversations
            rir.view.addConversationsToInbox(filteredConversations);

            // Show contacts
            rir.view.updateContactList(conversations);
            
            // Hide overlay
            if(hideOverlay)
            rir.view.hideOverlay();        
        },
        setFavicon: function(){
            var conversations = rir.model.cache.conversations;
            
            // Set icon to colored version if there are new messages
            var icon = '16-gray.png';
            for(var i = 0; i < conversations.length; i++) {
                if(conversations[i]['new']) {
                    icon = '16.png';
                    break;
                }
            }
            
            $('head link[rel="shortcut icon"]').remove();

            var link = document.createElement('link');
            link.type = 'image/png';
            link.rel = 'shortcut icon';
            link.href = chrome.extension.getURL('Icons/' + icon);
            document.querySelector('head').appendChild(link);
        },
        update: function(){
            // Init search from URL
            rir.view.hideOverlay();
            rir.controller.parseUrl();
            rir.view.updateBodyClass();

            if(rir.show === "conversation") {
                // Show this conversation
                rir.model.getConversation(rir.showid, rir.view.showConversation)
                // Update contact list
                rir.model.getConversations(rir.view.updateContactList);
            }
            if(['inbox', 'saved', 'deleted'].indexOf(rir.show) >= 0) {
                // Fetch all conversations and add them to the inbox view
                rir.model.getConversations(rir.view.showInbox);
            }
        },
        addMessageInInbox: function(conversation) {
            var unread = conversation['new'],
                id = conversation.id,
                correspondent = conversation.correspondent,
                subject = conversation.subject,
                message = conversation.text.replace('&amp;', "&").replace('&lt;', "<").replace('&gt;', ">"),
                datetime = conversation.last_update;

            var checkboxId = 'rir_cb_' + id;
            var html = replaceAll(rir.templates.inbox_message_row, "{checkboxid}", checkboxId);
            var $row = $(html).appendTo(rir.$e.mainPanel);

            if(unread) $row.addClass('rir-unread');
            $row.data('conversation', conversation);
            $row.find('.rir-correspondent').text(correspondent);
            $row.find('.rir-subject').text(subject);
            $row.find('.rir-text').text(message);
            $row.find('.rir-datetime').text(dateString(datetime));

            var $checkbox = $row.find('input');
            $checkbox.on('change', function(){
                $row.toggleClass('rir-row-checked');
            });
            $row.on('click', rir.controller.showMessageClick);
            $row.find('.rir-checkbox').on('click', function(e){
                e.stopPropagation();
            });
        },
        updateBodyClass: function(){
            if(['inbox', 'saved', 'deleted'].indexOf(rir.show) < 0) return;
            rir.$e.body.removeClass('rir-show-inbox rir-show-saved rir-show-deleted');
            rir.$e.body.addClass('rir-show-' + rir.show);
        },
        initLayout: function(){
            //  Set page title
            document.title = rir.cfg.data.pageTitle;
            $('<title>').text(rir.cfg.data.pageTitle);
            
            // Establish container for saved DOM elements
            rir.$e = {
                body : $('body'),
                loading: $('<span class="rir-loading-icon">'),
                get statusText(){
                    var $ele = $('.loading-message .rir-loading-status');
                    if($ele.length > 0) return $ele;
                    var $load = $('.loading-message');
                    if($load.length > 0) {
                        return $('<span class="rir-loading-status">').appendTo($load);
                    }
                    return $('<div>');
                }
            };
            
            // "uh" is used to send messages
            rir.model.uh = rir.$e.body.find('input[name="uh"]').val();
            // If history.pushState has been used, popstate should trigger a view update
            $(window).on('popstate', rir.view.update);

            // Create global container
            rir.$e.content = $('<div class="rir-content">').appendTo($('body > .content'));
            rir.$e.overlay = $('<div class="rir-overlay">').appendTo(rir.$e.body);

            // Load page content
            rir.$e.content.html(rir.templates.inbox_layout);
            rir.$e.mainPanel = $('.rir-main-panel').width(window.innerWidth - 220);
            rir.$e.contacts = $('.rir-contacts');
            rir.$e.search = $('#RirSearchInput');
            rir.$e.searchBtn = $('#RirSearchButton');

            // On window resize, resize the width of the main panel
            $(window).on('resize', function(){
                rir.$e.mainPanel.width(window.innerWidth - 220);
            });

            // Rebind the inbox / saved / deleted buttons
            // So that the entire page wont have to be redownloaded
            rir.$e.content.find('a.rir-link').on('click', function(e){
                var url = $(this).attr('href');
                var refresh = location.pathname === url;
                rir.$e.search.val('');
                e.preventDefault();
                
                if(refresh) {
                    rir.controller.reloadInbox();
                }
                else {
                    history.pushState({}, rir.cfg.data.pageTitle, url);
                    rir.view.update();
                }
            });

            // Bind our searchbar
            rir.$e.searchBtn.on('click', function(){
                rir.controller.search(rir.$e.search.val());
            });
            rir.$e.search.on('keyup', function(e){
                // Should eventually also do something with auto complete or something like that
                if(e.keyCode === 13) rir.controller.search(rir.$e.search.val());
            });

            // If the URL includes a search, place the search in the search bar
            if(rir._get.search) {
                rir.$e.search.val(decodeURIComponent(rir._get.search));
            }
        },
        bindActionButtons: function(){
            $('#RirDelete').on('click', rir.controller.action.delete);
            $('#RirRestore').on('click', rir.controller.action.restore);
            $('#RirSave').on('click', rir.controller.action.save);
            $('#RirUnsave').on('click', rir.controller.action.unsave);
            $('#RirMarkRead').on('click', rir.controller.action.markRead);
            $('#RirMarkUnread').on('click', rir.controller.action.markUnread);
            $('#RirShowConfig').on('click', rir.view.showConfig);
        },
        showExportAllOptions: function(e){
            var html = rir.templates.export_all_window;
            html = replaceAll(html, '{DATE}', sysDateStr());
            html = replaceAll(html, '{TIME}', sysTimeStr());
            
            var $export = $(html);
            $export.find('a').on('click', rir.controller.exportAll);
            $export.on('click', function(e){
                e.stopPropagation();
            });
            
            rir.$e.overlay.empty().removeClass('rir-light-overlay').append($export);
            rir.view.showOverlay(null, true);
            
            // This should not be needed, but apparently it is
            e.stopPropagation();
            
            // Make sure we have all conversations in cache
            rir.model.getConversations(function(conversations){
                rir.model.cache.conversations = conversations;
            });
        },
        showExportConversationOptions: function(e){
            var html = rir.templates.export_conversation_window;
            html = replaceAll(html, '{DATE}', sysDateStr());
            html = replaceAll(html, '{TIME}', sysTimeStr());
            
            var $export = $(html);
            $export.find('a').on('click', rir.controller.exportConversation);
            $export.on('click', function(e){
                e.stopPropagation();
            });
            
            rir.$e.overlay.empty().removeClass('rir-light-overlay').append($export);
            rir.view.showOverlay(null, true);
            
            // This should not be needed, but apparently it is
            e.stopPropagation();
        },
        showConfig: function(){
            var $config = $(rir.templates.config);
            
            var $showModMail = $config.find('#RirShowModMail');
            $showModMail.prop('checked', rir.cfg.data.showModmail);
            $showModMail.on('change', function(){
                var checked = $showModMail.prop('checked');
                rir.cfg.set('showModmail', checked);
                rir.view.showInbox(rir.model.cache.conversations, false);
            });
            
            $config.find('#RirResetInbox').on('click', function(){
                rir.$e.overlay.empty().removeClass('rir-light-overlay').off();
                rir.controller.resetInbox();
            });
            $config.find('#RirExportMessages').on('click', rir.view.showExportAllOptions);
            $config.on('click', function(e){
                e.stopPropagation();
            });
            
            rir.$e.overlay.empty().append($config);
            rir.view.showOverlay('rir-light-overlay', true);
        },
        showOverlay: function(addClass, clickToDismiss){
            rir.$e.overlay.show();
            setTimeout(function(){
                rir.$e.overlay.addClass('show');
            }, 10)
            
            if(typeof addClass === "string") {
                rir.$e.overlay.addClass(addClass);
            }
            if(typeof clickToDismiss === "boolean" && clickToDismiss) {
                rir.$e.overlay.on('click', rir.view.hideOverlay);
            }
        },
        hideOverlay: function(){
            rir.$e.overlay.off().removeClass('show rir-light-overlay');
            setTimeout(function(){
                rir.$e.overlay.hide();
            }, 600);
        },
        isLoading: function(){
            return $('.rir-overlay.show .loading-message').length > 0;
        },
        showLoading: function(message){
            if(message === undefined) message = 'Loading';
            var $element;
            if(rir.view.isLoading()) {
                $element = $('.rir-overlay.show .loading-message').text(message).prepend(rir.$e.loading.clone());
            }
            else {
                $element = $('<div class="loading-message">').text(message).prepend(rir.$e.loading.clone()).appendTo(rir.$e.overlay.empty());
                rir.view.showOverlay();
            }
            return $element;
        },
        showNotification: function(message, duration){
            if(typeof duration === "undefined") duration = 1500;
            if(message === undefined) message = 'Loading';
            $('<div class="notification-message">').text(message).appendTo(rir.$e.overlay.empty());
            rir.$e.overlay.show().addClass('show');
            
            if(duration < 0) return;
            setTimeout(function(){
                rir.view.hideOverlay();
            }, duration);
        },
        addContactToList: function(contact) {
            var html = replaceAll(rir.templates.contact_row, '{username}', contact);
            var $row = $(html).data('user', contact);
            $row.find('.rir-show-messages').on('click', function(e){
                rir.$e.search.val('from:' + contact);
                rir.controller.search('from:' + contact);
                e.preventDefault();
            });
            $row.appendTo(rir.$e.contacts);
        },
        addConversationsToInbox: function(conversations){
            var copy = conversations.slice();
            var conversationsAdded = 0;
            for(var i = 0; i < copy.length; i++) {
                var conversation = copy[i];
                
                // Add message to inbox
                rir.view.addMessageInInbox(conversation);
                
                // If the maximum number of conversations has been added
                if(++conversationsAdded > rir.cfg.data.maxInitialMessagesShown){
                    // Add load more content element
                    rir.view.addLoadMoreElement(
                        rir.templates['load_more_messages'],
                        rir.$e.mainPanel,
                        rir.view.addConversationsToInbox,
                        copy.splice(i + 1));
                        
                    break;
                }
            }
        },
        addContactsToContactList: function(contacts){
            for(var i = 0; i < contacts.length; i++) {
                var contact = contacts[i];
                rir.view.addContactToList(contact);
                
                if((i + 1) === rir.cfg.data.maxContacts) {
                    rir.view.addLoadMoreElement(
                        rir.templates['load_more_contacts'],
                        rir.$e.contacts,
                        rir.view.addContactsToContactList,
                        contacts.splice(i + 1)
                        );
                    break;
                }
            }
        },
        showStatus: function(statusMsg){
            if(statusMsg !== false) {
                rir.$e.statusText.text(statusMsg);
            }
            else {
                rir.view.hideOverlay();
                setTimeout(function(){
                    rir.view.showNotification("The system failed too many times in retrieving messages, please try again at a later time.");
                }, 1000);
            }
        },
        addLoadMoreElement: function(html, $container, callback, items){
            var $element = $(html).appendTo($container);
            var scrollCallback = function(){
                if(!isElementInViewport($element)) return;
                $(window).off('scroll', scrollCallback);
                $element.remove();
                callback(items);
            };
            $(window).on('scroll', scrollCallback);
            scrollCallback();
        }
    };
    rir.controller = {
        resetInbox: function(){
            rir.view.showLoading('Clearing inbox');
            rir.proxy(['rir', 'db', 'clearObjectStore'], [db_tables.privateMessages.name], function(){
                rir.cfg.set('pmInboxInitialized', false);
                rir.controller.reloadInbox();
            });
        },
        showMessageClick: function() {
            var conversation = $(this).data('conversation');
            history.pushState({}, rir.cfg.data.pageTitle, '/message/rir_conversation/' + conversation.id);
            rir.controller.parseUrl();            
            rir.view.showConversation(conversation);
            
            // Scroll to the top
            window.scrollTo(0, 0);
        },
        reloadInbox: function(){
            rir.view.showLoading();
            rir.model.updateDb(function(){
                rir.view.update();
                rir.view.setFavicon();
            }, function(errorMessage){
                rir.view.showNotification(message, -1);
                console.error("DB has NOT been updated", arguments);
            });
        },
        search: function(query){
            history.pushState({}, rir.cfg.data.pageTitle, '/message/rir_inbox?search=' + query);
            rir.view.update();
        },
        parseUrl: function(){
            delete rir['showid'];
            var pathParts = location.pathname.split('/');
            if(pathParts[2] === "rir_conversation" && pathParts.length >= 4) {
                rir.show = "conversation";
                rir.showid = pathParts[3];
            }
            else if(pathParts[2] === "rir_saved"){
                rir.show = "saved";
            }
            else if(pathParts[2] === "rir_deleted"){
                rir.show = "deleted";
            }
            else {
                rir.show = "inbox";
            }

            rir._get = parseQueryString(location.search);
            if(rir._get.search) {
                rir._get.searchObj = parseSearchQuery(rir._get.search);
            }
            else if(rir._get.searchObj) {
                delete rir._get['searchObj'];
            }
        },
        exportAll: function(e){
            var $ele = $(this);
            var format = $ele.data('format');
            
            var conversations = rir.model.cache.conversations.slice();
            
            // Filter deleted and modmail, if that's configged
            if(!rir.cfg.data.showModmail) rir.model.modmailFilter(conversations);
            rir.model.directoryFilter(conversations, 'inbox');
            
            if($('#RedactUsernames').prop('checked')) {
                conversations = rir.model.names.substituteUsernames(conversations);
            }
            
            var data = rir.controller.exportFormats[format](conversations, e);
            
            var dataBlob = new Blob([data], {type : 'text/plain'});
            var downloadUrl = URL.createObjectURL(dataBlob);
            this.href = downloadUrl;
        },
        exportFormats: {
            JSON: function(conversations){
                return JSON.stringify(conversations);
            },
            HTML: function(conversations, e){
                e.stopPropagation();
                e.preventDefault();
                alert('Not yet implemented');
            },
            MySQL: function(conversations){
                var sql = rir.templates.export_all_to_mysql;
                var contexts = rir.model.getConversationContexts(conversations);
                var messages = rir.model.removeConversationContexts(conversations);
                
                var contextKeys = ['id', 'correspondent', 'modmail', 'last_update', 'subject', 'text', 'new'];
                var insertContextsRows = [];
                for(var i = 0; i < contexts.length; i++) {
                    var context = contexts[i];
                    var sqlCols = [];
                    sqlCols.push(JSON.stringify("" + context.id));
                    sqlCols.push(JSON.stringify("" + context.correspondent));
                    sqlCols.push(context.modmail ? '"1"' : '"0"');
                    sqlCols.push(JSON.stringify("" + parseInt(context.last_update)));
                    sqlCols.push(JSON.stringify("" + context.subject));
                    sqlCols.push(JSON.stringify("" + context.text));
                    sqlCols.push(context['new'] ? '"1"' : '"0"');
                    
                    insertContextsRows.push(sqlCols.join(', '));
                }
                
                sql +=
                    'INSERT INTO `redditPrivateMessageContexts` '
                    + '(`' + contextKeys.join('`, `') + '`) '
                    + ' VALUES (' + insertContextsRows.join('), (') + ');';
                
                var messageKeys = ['id', 'name', 'first_message_name', 'author', 'dest', 'created_utc', 'subject', 'body', 'body_html', 'new', 'distinguished'];
                var insertMessageRows = [];
                for(var i = 0; i < messages.length; i++) {
                    var message = messages[i];
                    var sqlCols = [];
                    sqlCols.push(JSON.stringify("" + message.id));
                    sqlCols.push(JSON.stringify("" + message.name));
                    sqlCols.push(JSON.stringify("" + message.first_message_name));
                    sqlCols.push(JSON.stringify("" + message.author));
                    sqlCols.push(JSON.stringify("" + message.dest));
                    sqlCols.push(JSON.stringify("" + parseInt(message.created_utc)));
                    sqlCols.push(JSON.stringify("" + message.subject));
                    sqlCols.push(JSON.stringify("" + message.body));
                    sqlCols.push(JSON.stringify("" + message.body_html));
                    sqlCols.push(message['new'] ? '"1"' : '"0"');
                    sqlCols.push(JSON.stringify("" + message.distinguished));
                    
                    insertMessageRows.push(sqlCols.join(', '));
                }
                
                sql +=
                    'INSERT INTO `redditPrivateMessages` '
                    + '(`' + messageKeys.join('`, `') + '`) '
                    + ' VALUES (' + insertMessageRows.join('), (') + ');';
                
                return sql;
            },
            CSV: function(conversations){
                var messages = rir.model.removeConversationContexts(conversations);
                var sampleMessage = messages[0];
                var keys = Object.keys(sampleMessage);
                var csvRows = [keys];
                
                for(var i = 0; i < messages.length; i++) {
                    var rowData = [];
                    for(var j = 0; j < keys.length; j++) {
                        var k = keys[j];
                        var v = messages[i][k];
                        if(k === 'created_utc') v = sysDateStr(messages[i][k] * 1000) + ' ' + sysTimeStr(messages[i][k] * 1000, ':') + ' UTC';
                        rowData.push(v);
                    }
                    csvRows.push(rowData);
                }
                
                return array2DtoCSV(csvRows);
            },
            TXT: function(conversations){
                var txt = '';
                for(var i = 0; i < conversations.length; i++) {
                    if(i > 0) {
                        txt += "\r\n---\r\n---\r\n";
                    }
                    var conversation = conversations[i];
                    txt += '# ' + conversation.subject + "\r\n\r\n";
                    for(var j = 0; j < conversation.messages.length; j++) {
                        if(j > 0) {
                            txt += "\r\n---\r\n";
                        }
                        
                        var message = conversation.messages[j];
                        txt += 'From: ' + message.author + ' | Date / time: ' + sysDateStr(message.created_utc * 1000) + ' ' + sysTimeStr(message.created_utc * 1000, ':') + ' UTC' + "\r\n\r\n";
                        txt += message.body.replace("\r", "").replace("\n", "\r\n") + "\r\n";
                    }
                }
                return txt;
            },
            'SINGLE-HTML': function(conversations){
                var $eleClone = $('.rir-conversation').clone();
                $eleClone.find('.rir-conversation-response').remove();
                $eleClone.find('.rir-private-message').removeClass('rir-collapsed');
                $eleClone.find('button').remove();
                var html =  $eleClone.html();
                
                if($('#RedactUsernames').prop('checked')) {
                    var names = rir.model.names.extractUsernames(conversations);
                    var substitutions = rir.model.names.getNameSubstitutes(names);
                    
                    for(var i = 0; i < names.length; i++) {
                        var name = names[i];
                        var substitution = substitutions[name];
                        html = replaceAll(html, name, substitution);
                    }
                }
                
                
                var html = rir.templates.export_conversation_to_html.replace('!BODY!', html);
                return html;
            }
        },
        exportConversation: function(e){
            var $ele = $(this);
            var format = $ele.data('format');
            
            var conversations = [$('.rir-conversation').data('conversation')];
            
            // Filter deleted and modmail, if that's configged
            if(!rir.cfg.data.showModmail) rir.model.modmailFilter(conversations);
            rir.model.directoryFilter(conversations, 'inbox');
            
            if($('#RedactUsernames').prop('checked') && format !== 'SINGLE-HTML') {
                conversations = rir.model.names.substituteUsernames(conversations);
            }
            
            var data = rir.controller.exportFormats[format](conversations, e);
            
            var dataBlob = new Blob([data], {type : 'text/plain'});
            var downloadUrl = URL.createObjectURL(dataBlob);
            this.href = downloadUrl;
        },
        action: {
            get conversations(){
                if(rir.show === "conversation") {
                    return [$('.rir-conversation').data('conversation')];
                }
                else if(['inbox', 'saved', 'deleted'].indexOf(rir.show) >= 0) {
                    var conversations = [];
                    var $checked = $('.rir-message-row .rir-checkbox input[type="checkbox"]:checked');
                    $checked.each(function(){
                        var $row = $(this).closest('.rir-message-row');
                        var conversation = $row.data('conversation');
                        conversation.$e = $row;
                        conversations.push(conversation);
                    });
                    return conversations;
                }
            },
            delete: function(){
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var conversation = conversations[i];
                    var id = conversation.id;
                    if(!rir.cfg.deleted.contains(id)) {
                        rir.cfg.deleted.add(id);
                        if(rir.show === "conversation") {
                            history.back();
                        }
                        else if(rir.show !== "deleted") {
                            conversation.$e.slideUp(function(){
                                conversation.$e.remove();
                            });
                        }
                    }
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was deleted' : 'The messages were deleted';
                rir.view.showNotification(msg);
            },
            restore: function(){
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var conversation = conversations[i];
                    var id = conversation.id;
                    if(rir.cfg.deleted.contains(id)) {
                        rir.cfg.deleted.remove(id);
                        if(rir.show === "deleted") {
                            conversation.$e.slideUp(function(){
                                conversation.$e.remove();
                            });
                        }
                    }
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was restored' : 'The messages were restored';
                rir.view.showNotification(msg);
            },
            save: function(){
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var id = conversations[i].id;
                    if(!rir.cfg.saved.contains(id)) {
                        rir.cfg.saved.add(id);
                    }
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was saved' : 'The messages were saved';
                rir.view.showNotification(msg);
            },
            unsave: function(){
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var conversation = conversations[i];
                    var id = conversation.id;
                    if(rir.cfg.saved.contains(id)) {
                        rir.cfg.saved.remove(id);
                        if(rir.show === "saved") {
                            conversation.$e.slideUp(function(){
                                conversation.$e.remove();
                            });
                        }
                    }
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was unsaved' : 'The messages were unsaved';
                rir.view.showNotification(msg);
            },
            markRead: function(){
                //.rir-unread
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var conversation = conversations[i];
                    conversation.$e.removeClass('rir-unread');
                    delete conversation['$e'];
                    rir.model.setConversationStatus(conversation, true);
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was marked read' : 'The messages were marked read';
                rir.view.showNotification(msg);
            },
            markUnread: function(){
                var conversations = rir.controller.action.conversations;
                for(var i = 0; i < conversations.length; i++) {
                    var conversation = conversations[i];
                    conversation.$e.addClass('rir-unread');
                    delete conversation['$e'];
                    rir.model.setConversationStatus(conversation, false);
                }
                
                if(!conversations.length) return;
                var msg = (conversations.length === 1) ? 'The message was marked unread' : 'The messages were marked unread';
                rir.view.showNotification(msg);
            }
        }
    };
    rir.model = {
        setConversationStatus: function(conversation, read) {
            var updated = [];
            for(var i = 0; i < conversation.messages.length; i++) {
                if(conversation.messages[i]['new'] === read) {
                    conversation.messages[i]['new'] = !read;
                    updated.push(conversation.messages[i]);
                }
            }
            rir.proxy(['rir', 'db', 'updateAll'], [db_tables.privateMessages.name, updated], function(){
                
            });
        },
        getSortedContactsFromConversations: function(conversations){
            var contacts = {};
            for(var i = 0; i < conversations.length; i++) {
                var conversation = conversations[i];
                var contact = conversation.correspondent;
                if(!contact) continue;
                if(contact === "[deleted]") continue;
                if(contact[0] === "#") continue;

                if(!contacts[contact]) {
                    contacts[contact] = 0;
                }
                contacts[contact] += 1 + (conversation.messages.length / 3);
            }
            var contactsArr = Object.keys(contacts);
            contactsArr.sort(function(a, b){
                if(contacts[a] > contacts[b]) return -1;
                if(contacts[a] === contacts[b]) return 0;
                if(contacts[a] < contacts[b]) return 1;
            });
            return contactsArr;
        },
        modmailFilter: function(conversations){
            for(var i = 0; i < conversations.length; i++) {
                var conversation = conversations[i];
                if(conversation.modmail) {
                    conversations.splice(i--, 1);
                }
            }
        },
        directoryFilter: function(conversations, directory){
            if(typeof directory === "undefined") {
                directory = rir.show;
            }
            
            for(var i = 0; i < conversations.length; i++) {
                var conversation = conversations[i];

                var saved = rir.cfg.saved.contains(conversation.id);
                var deleted = rir.cfg.deleted.contains(conversation.id);

                if(directory === "saved" && !saved
                || directory === "deleted" && !deleted
                || directory !== "deleted" && deleted) {
                    conversations.splice(i--, 1);
                }
            }
        },
        searchFilter: function(conversations){
            if(!rir._get.searchObj) return;
            for(var i = 0; i < conversations.length; i++) {
                var conversation = conversations[i];
                if(!rir.model.searchMatchCheck(conversation)) {
                    conversations.splice(i--, 1);
                }
            }
        },
        searchMatchCheck: function(conversation){
            var searchObj = rir._get.searchObj;
            if(searchObj.from && conversation.correspondent && searchObj.from.toLowerCase() === conversation.correspondent.toLowerCase()) {
                return true;
            }
            if(searchObj.subject) {
                var subject = conversation.subject.toLowerCase();
                var terms = rir._get.searchObj.subject;
                var termsFound = 0;
                for(var j = 0; j < terms.length; j++) {
                    var term = terms[j].toLowerCase();
                    if(subject.indexOf(term) >= 0) {
                        termsFound++;
                    }
                }
                if(termsFound >= terms.length) {
                    return true;
                }
            }
            if(searchObj.message) {
                var terms = searchObj.subject;
                var termsFound = 0;
                for(var j = 0; j < terms.length; j++) {
                    for(var k = 0; k < conversation.messages.length; k++) {
                        var message = conversation.messages[k].body.toLowerCase();
                        var term = terms[j].toLowerCase();
                        if(message.indexOf(term) >= 0) {
                            termsFound++;
                            break;
                        }
                    }
                }
                if(termsFound >= terms.length) {
                    return true;
                }
            }
            return false;
        },
        names: {
            get generatedNames(){
                var names = [];
                var firstNames = [
                    'Rock', 'Balloon', 'Clamp', 'Cork', 'Car',
                    'Tooth', 'Stick', 'Card', 'Fork', 'Puddle',
                    'Knife', 'Butter', 'Table', 'Box', 'Helmet',
                    'Chalk', 'Shoe', 'Tomato', 'Broccoli', 'Watch',
                    'Bottle', 'Glass', 'Flag', 'Pillow', 'Spoon',
                    'Scizzors', 'Egg', 'Carrot', 'Bread', 'Drawer',
                    'Wallet', 'Monitor', 'Plank', 'Floor', 'Lamp',
                    'Body', 'Pipe', 'Filter', 'State', 'Park'
                ];
                var lastNames = [
                    'Paper', 'Chain', 'Tile', 'Truck', 'Piano',
                    'Milk', 'Salt', 'Page', 'Mirror', 'Can',
                    'Ball', 'Brick', 'Tree', 'Shovel', 'Space',
                    'Globe', 'Note', 'Pepper', 'Street', 'Town',
                    'Leaf', 'Spiral', 'Light', 'Dark', 'Code',
                    'Spring', 'Couch', 'Phone', 'Map', 'Bridge',
                    'Sign', 'Pants', 'Shirt', 'Plane', 'Pear',
                    'Bench', 'Flyer', 'Case', 'Chart', 'Door'
                ];
                
                for(var i = 0; i < firstNames.length; i++) {
                    for(var j = 0; j < lastNames.length; j++) {
                        names.push(firstNames[i] + ' ' + lastNames[j]);
                    }
                }
                return rir.model.names.generatedNames = array_shuffle(names);
            },
            extractUsernames: function(conversations){
                var names = [];
                for(var i = 0; i < conversations.length; i++){
                    var messages = conversations[i].messages;
                    for(var j = 0; j < messages.length; j++) {
                        var msg = messages[j];
                        
                        if(names.indexOf(msg.author) < 0) names.push(msg.author);
                        if(names.indexOf(msg.dest) < 0) names.push(msg.dest);
                    }
                }
                return names;
            },
            getNameSubstitutes: function(names){
                var substitutions = {};
                for(var i = 0; i < names.length; i++){
                    var name = names[i];
                    var substitute = rir.model.names.generatedNames[i];
                    substitutions[name] = substitute;
                }
                return substitutions;
            },
            substituteUsernames: function(conversations){
                var names = rir.model.names.extractUsernames(conversations);
                var substitutions = rir.model.names.getNameSubstitutes(names);
                
                var copy = conversations.slice();
                for(var i = 0; i < copy.length; i++) {
                    var c = copy[i];
                    c.correspondent = substitutions[c.correspondent];
                    
                    for(var j = 0; j < c.messages.length; j++) {
                        c.messages[j].author = substitutions[c.messages[j].author];
                        c.messages[j].dest = substitutions[c.messages[j].dest];
                    }
                }
                return copy;
            }
        },
        getConversationContexts: function(conversations){
            var contexts = [];
            for(var i = 0; i < conversations.length; i++) {
                var context = JSON.parse(JSON.stringify(conversations[i]));
                delete context.messages;
                contexts.push(context);
            }
            return contexts;
        },
        removeConversationContexts: function(conversations){
            var messages = [];
            for(var i = 0; i < conversations.length; i++) {
                var conversation = conversations[i];
                for(var j = 0; j < conversation.messages.length; j++) {
                    messages.push(conversation.messages[j]);
                }
            }
            return messages;
        },
        cache: {
            conversations: []
        }
    };
    rir.markdown = SnuOwnd.getParser();
    
    rir.init.start();
    rir.init.executeAfter(['DOMReady', 'preloadTemplatesReady'], function(){
        // Don't do anything if it's a 503
        if(document.title.indexOf("Ow!") >= 0) return;
        if(!isLoggedIn()) return;
        
        // The DOM is ready and templates have been preloaded
        
        // Parse the URL
        rir.controller.parseUrl();
        
        // Initialize default layout elements
        rir.view.setFavicon();
        
        rir.functions.initConfig(function(){
            rir.view.initLayout();
            rir.view.bindActionButtons();
            rir.view.showLoading();
            
            rir.proxy(['rir', 'db', 'init'], [], rir.controller.reloadInbox);
        });
        
    });
    
})(jQuery);