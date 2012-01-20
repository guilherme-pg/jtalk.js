function JTalk(server, user, password) {
    // namespace for chat states
    Strophe.NS.CHATSTATE = "http://jabber.org/protocol/chatstates";

    var connection = new Strophe.Connection(server);

    /* Get the chat with a given contact, creating it if it doesn't exist and
     * 'create' is enabled (default: true).
     * When the chat window is first created, triggers the "new chat"
     * hook.
     */
    var _active_chats = {};
    function chat(contact, create) {
        /* Create the chat windows' elements */
        function createChatWindow() {
            // create the element
            var window_markup = [
                "<div class='ui-jtalk-chat-window'>",
                    "<div class='ui-jtalk-chat-history'></div>",
                    "<div class='ui-jtalk-chat-state'></div>",
                    "<div class='ui-jtalk-chat-textwrapper'>",
                        "<textarea class='ui-jtalk-chat-input'></textarea>",
                    "</div>",
            ];

            return $(window_markup.join("")).get();
        }

        /* Build a handler for keydown events in the window's text area. */
        function keydownHandler(_self) {
            return function(e) {
                var message = $(this).val();

                if (e.which == 13) {
                    // return key pressed -- send message
                    $(this).val("");

                    _self._sendMessage(message, "active");
                    _self._addMessageToHistory("me", message);

                    return false;
                }

                if (e.which > 31 && !message &&
                    _self._chatstate != "composing") {
                    // send composing chat status, but only if this is
                    // the first keypress of a printable character
                    _self._sendMessage(null, "composing");
                }

                return true;
            }
        }

        /* Build a handler for keyup events in the window's text area. */
        function keyupHandler(_self) {
            return function(e) {
                if (!$(this).val() &&
                    _self._chatstate != "active") {
                    _self._sendMessage(null, "active");
                }

                return true;
            }
        }

        // the real constructor, out of sight
        function _chat(contact) {
            this.contact = contact;
            this.element = createChatWindow();

            /* Unregister this chat.
             * A new window will be created for subsequent messages.
             */
            this.unregister = function() {
                // leave window cleanup to the user
                delete _active_chats[this.contact];
            }

            /* Get the history for this chat as an array of arrays
             * [from, message] as displayed in the chat window.
             */
            this.getHistory = function() {
                var last_from = null;
                var history = [];

                var s = ".ui-jtalk-chat-history p";
                $(this.element).find(s).each(function() {
                        // get the sender from the span tag, if any
                        var from = $(this)
                                   .find(".ui-jtalk-chat-history-from")
                                   .text()
                                   .slice(0, -1); // remove :

                        // get the text from all nodes below the message's
                        // paragraph, except the one with 'from'
                        var text = $(this)
                                   .contents()
                                   .filter(function() {
                                       var cls = "ui-jtalk-chat-history-from";
                                       return !$(this).hasClass(cls);
                                    })
                                   .text()
                                   .slice(!!from); // remove &nbsp, if any

                        if (!from) from = last_from;
                        last_from = from;

                        history.push([from, text]);
                    });

                return history;
            }

            // create a shallow copy with only the public data above
            // we can send to hook handlers.
            this._pub = $.extend(new Object(), this);

            if (!trigger("new chat", this._pub)) {
                $(document.body).append(this.element);
            }

            this._chatstate = null;
            this._last_from = null;

            /* Send a message with chatstate support */
            this._sendMessage = function(message, chatstate) {
                var stanza = $msg({to: this.contact.jid,
                                   from: user,
                                   type: "chat"});

                if (message !== null) stanza.c("body", message);
                if (chatstate !== null) {
                    this._chatstate = chatstate;
                    stanza.c(chatstate, {xmlns: Strophe.NS.CHATSTATE});
                }

                connection.send(stanza);
            }

            /* Display a message sent by 'from' in the history.
             * Triggers "new message".
             */
            this._addMessageToHistory = function (from, msg) {
                // suppress 'from' if the sender is the same as before
                if (from == this._last_from) from = null;
                else this._last_from = from;

                // give the handler a chance to modify the message
                var _msg = trigger("new message", {chat: this._pub, text: msg});
                if (!_msg) return;

                if (typeof _msg === "string") {
                    msg = _msg;
                }

                // build entry for the history
                var entry = $("<p>");
                if (from) {
                    var span = $("<span class='ui-jtalk-chat-history-from'>");
                    span.append(from + ":");

                    $(entry).append(span).append("&nbsp;");
                }

                $(entry).append(msg);

                // add message to the history and scroll down
                var history = $(this.element).find(".ui-jtalk-chat-history");
                history.append(entry).scrollTop(history.height());
            }

            /* Display the contact's chat state in the chat window.
             * Triggers "chat state received"
             */
            this._displayChatState = function(chatstate) {
                var default_chatstate_messages = {
                    "active": "",
                    "inactive": this.contact.name + " is inactive.",
                    "gone": "",
                    "composing": this.contact.name + " is composing a message.",
                    "paused": this.contact.name + " wrote a message."
                }

                var m = trigger("chat state received",
                                {chat: c._pub, chatstate: chatstate});

                if (!m) {
                    m = default_chatstate_messages[chatstate];
                } else if (typeof m !== "string") {
                    return;
                }

                $(this.element).find(".ui-jtalk-chat-state").text(m);
            }

            // register callbacks to handle text input
            $(this.element).find("textarea")
                .keydown(keydownHandler(this)).keyup(keyupHandler(this));
        }

        if (create === undefined) {
            create = true;
        }

        var c = _active_chats[contact];
        if (!c && Boolean(create) != false) {
            c = new _chat(contact);
            _active_chats[contact] = c;
        }

        return c;
    }

    /* Constructor for contact objects.
     * Each contact encapsulates information about a single contact
     * in the user's roster.
     * Given only a jid, returns the existing contact with that jid.
     * Given also an item tag, builds a new contact with information from that
     * tag, replaces the old contact (if any) and returns the new contact.
     */
    var roster = {};
    function contact(jid, item) {
        // the real constructor
        function _contact(item) {
            var contact_attrs = ["jid", "name", "group", "subscription"];

            for (i = 0; i < contact_attrs.length; i++) {
                var a = contact_attrs[i];
                this[a] = $(item).attr(a);
            }

            if (!this.name) {
                this.name = this.jid;
            }

            // TODO: send presence probe?

            this.element = $("<li>").append(this.name).get(0);
            $("#ui-jtalk-roster").append(this.element);

            $(this.element).click(function() {
                for (jid in roster) {
                    var cont = roster[jid];

                    if (cont.element === this) {
                        var c = chat(cont._pub);
                        trigger("chat requested", c._pub);
                        break;
                    }
                }
            });

            /* Remove a contact from the roster */
            this.remove = function() {
                console.log("removing " + jid);
                var iq = $iq({from: user,
                              type: "set",
                              id: iqId("roster_remove_" + this.jid)});
                iq.c("query", {xmlns: "jabber:iq:roster"});
                iq.c("item", {jid: this.jid, subscription: "remove"});

                connection.send(iq);
            }

            this._pub = $.extend(new Object(), this);

            /* Remove this contact's element from the roster list */
            this._removeElement = function() {
                $(this.element).remove();
            }
        }

        jid = Strophe.getBareJidFromJid(jid);
        if (item !== undefined) {
            roster[jid] = new _contact(item);
        }

        return roster[jid];
    }

    /* A simple decorator that parses the common attributes out
     * of XMPP stanzas.
     * The decorated function receives the attributes in object notation.
     */
    function withCommonAttributes(f) {
        function _f(stanza) {
            var common_attrs = ["to", "from", "id", "type", "xml:lang"];

            var attrs = {}
            for (i = 0; i < common_attrs.length; i++) {
                var a = common_attrs[i];
                attrs[a] = $(stanza).attr(a);
            }

            return f(stanza, attrs);
        }

        return _f;
    }

    /* Build a unique id for iq stanzas, based on a key. */
    var time = new Date();
    function iqId(key) {
        return key + ":" + time.getTime();
    }

    /* Callback for message stanzas.
     */
    this.onMessage = withCommonAttributes(
        function(message, attrs) {
            var body = $(message).find("body:first");
            var cont = contact(attrs.from);
            var c = chat(cont._pub, false);

            if (body.length != 0) {
                c = chat(cont._pub); // make sure the chat exists
                var node = Strophe.getNodeFromJid(attrs.from);
                var text = body.text();

                c._addMessageToHistory(node, body.text());
            }

            // select the tag corresponding to the chat state
            var s = "*[xmlns='" + Strophe.NS.CHATSTATE + "']";
            var tag = $(message).find(s);
            if (tag.length != 0 && c) {
                var chatstate = tag.prop("tagName");
                c._displayChatState(chatstate);
            }

            return true;
        });

    /* Callback for subscription events */
    this.onSubscription = withCommonAttributes(
        function(presence, attrs) {
            // XXX blindly accept subscription
            trigger("subscription request", attrs.from);
            connection.send($pres({to: attrs.from, type: "subscribed"}));
            return true;
        });

    /* Callback for roster events.
     */
    this.onRosterReceived = withCommonAttributes(
        function onRosterReceived(iq, attrs) {
            console.log("roster event!");
            var s = "query[xmlns='" + Strophe.NS.ROSTER + "'] > item";
            $(iq).find(s).each(
                function() {
                    var jid = $(this).attr("jid");

                    if ($(this).attr("subscription") === "remove") {
                        contact(jid)._removeElement();
                    } else {
                        // force (re-)creation of the contact with new data
                        contact(jid, this);
                    }
                });

            if (attrs.type == "get" || attrs.type == "set") {
                // send response iq to the server
                var iq = $iq({to: server,
                              from: attrs.to,
                              type: "result",
                              id: attrs.id});

                connection.send(iq);
            }

            return true;
        });

    /* Callback for connection */
    this.onConnect = function(status) {
        if (status == Strophe.Status.CONNECTED) {
            // request roster
            var iq = $iq({from: user,
                type: "get",
                id: iqId("roster")});
            iq.c("query", {xmlns: "jabber:iq:roster"});
            connection.send(iq);

            // send presence
            connection.send($pres());

            return true;
        }
    }

    /* Connect to the server */
    this.connect = function() {
        connection.connect(user, password, this.onConnect);
        this._registerCallbacks();
    }

    /* Add a handler to a hook */
    this.addHandler = function(hook, handler) {
        hooks[hook] = handler;
    }

    /* Trigger a hook.
     * Returns the return value of the handler, or null if there is no handler.
     */
    var hooks = {};
    function trigger(name, arg) {
        if (hooks[name]) {
            return hooks[name](arg);
        }

        return null;
    }

    /* Register Strophe callbacks */
    this._registerCallbacks = function() {
        connection.addHandler(this.onMessage,
                              null,
                              "message",
                              null,
                              null,
                              null,
                              null);

        connection.addHandler(this.onSubscription,
                              null,
                              "presence",
                              "subscribe",
                              null,
                              null,
                              null);

        connection.addHandler(this.onRosterReceived,
                              Strophe.NS.ROSTER,
                              "iq",
                              null,
                              null,
                              null,
                              null);
    }
}
