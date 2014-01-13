/*
 * Tracelytics PageGuide
 *
 * Copyright 2013 Tracelytics
 * Free to use under the MIT license.
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Contributing Author: Tracelytics Team
 */

/*
 * PageGuide usage:
 *
 *  Preferences:
 *  auto_show_first:    Whether or not to focus on the first visible item
 *                      immediately on PG open (default true)
 *  loading_selector:   The CSS selector for the loading element. pageguide
 *                      will wait until this element is no longer visible
 *                      starting up.
 *  track_events_cb:    Optional callback for tracking user interactions
 *                      with pageguide.  Should be a method taking a single
 *                      parameter indicating the name of the interaction.
 *                      (default none)
 *  handle_doc_switch:  Optional callback to enlight or adapt interface
 *                      depending on current documented element. Should be a
 *                      function taking 2 parameters, current and previous
 *                      data-tourtarget selectors. (default null)
 *  custom_open_button: Optional id for toggling pageguide. Default null.
 *                      If not specified then the default button is used.
 *  pg_caption:         Optional - Sets the visible caption
 *  dismiss_welcome:    Optional function to permanently dismiss the welcome
 *                      message, corresponding to check_welcome_dismissed.
 *                      Default: sets a localStorage or cookie value for the
 *                      (hashed) current URL to indicate the welcome message
 *                      has been dismissed, corresponds to default
 *                      check_welcome_dismissed function.
 *  check_welcome_dismissed: Optional function to check whether or not the
 *                      welcome message has been dismissed. Must return true
 *                      or false. This function should check against whatever
 *                      state change is made in dismiss_welcome. Default:
 *                      checks whether a localStorage or cookie value has been
 *                      set for the (hashed) current URL, corresponds to default
 *                      dismiss_welcome function.
 */
tl = window.tl || {};
tl.pg = tl.pg || {};

(function ($) {

    tl.pg.default_prefs = {
        'auto_show_first': true,
        'loading_selector' : '#loading',
        'track_events_cb': function() { return; },
        'handle_doc_switch': null,
        'custom_open_button': null,
        'pg_caption' : 'page guide',
        'tourtitle': 'Open Page Guide for help',
        'check_welcome_dismissed': function () {
            var key = 'tlypageguide_welcome_shown_' + tl.pg.hashUrl();
            // first, try to use localStorage
            try {
                if (localStorage.getItem(key)) {
                    return true;
                }
            // cookie fallback for older browsers
            } catch(e) {
                if (document.cookie.indexOf(key) > -1) {
                    return true;
                }
            }
            return false;
        },
        'dismiss_welcome': function () {
            var key = 'tlypageguide_welcome_shown_' + tl.pg.hashUrl();
            try {
                localStorage.setItem(key, true);
            } catch(e) {
                var exp = new Date();
                exp.setDate(exp.getDate() + 365);
                document.cookie = (key + '=true; expires=' + exp.toUTCString());
            }
        },
        'ready_callback': null
    };

    tl.pg.wrapper_markup =
        '<div id="tlyPageGuideWrapper">' +
            '<div id="tlyPageGuideMessages">' +
                '<a href="#" class="tlypageguide_close" title="Close Guide">close</a>' +
                '<span class="tlypageguide_index"></span>' +
                '<div class="tlypageguide_text"></div>' +
                '<a href="#" class="tlypageguide_back" title="Previous">Previous</a>' +
                '<a href="#" class="tlypageguide_fwd" title="Next">Next</a>' +
            '</div>' +
            '<div id="tlyPageGuideContent"></div>' +
        '</div>';

    tl.pg.toggle_markup =
        '<div class="tlypageguide_toggle" title="Launch Page Guide">' +
            '<div><span class="tlypageguide_toggletitle"></span></div>' +
            '<a href="#" class="tlypageguide_close" title="close guide">close guide &raquo;</a>' +
        '</div>';

    tl.pg.init = function(preferences) {
        preferences = $.extend({}, tl.pg.default_prefs, preferences);
        clearInterval(tl.pg.interval);

        /* page guide object, for pages that have one */
        if ($("#tlyPageGuide").length === 0) {
            return;
        }

        var $guide = $("#tlyPageGuide");
        var $wrapper = $(tl.pg.wrapper_markup);

        var tourtitle = $guide.data('tourtitle') || preferences.tourtitle;

        if (preferences.custom_open_button == null && $('.tlypageguide_toggle').length < 1) {
            $wrapper.append(tl.pg.toggle_markup);
            $wrapper.find('.tlypageguide_toggle').prepend(preferences.pg_caption);
            $wrapper.find('.tlypageguide_toggletitle').text(tourtitle);
        }

        $wrapper.prepend($guide);

        // remove any stale pageguides
        $('#tlyPageGuideWrapper').remove();

        $('body').prepend($wrapper);

        var pg = new tl.pg.PageGuide($('#tlyPageGuideWrapper'), preferences);

        pg.ready(function() {
            pg.setup_welcome();
            pg.setup_handlers();
            pg.$base.children(".tlypageguide_toggle").animate({ "right": "-120px" }, 250);
            if (typeof(preferences.ready_callback) === 'function') {
                preferences.ready_callback();
            }
        });
        return pg;
    };

    tl.pg.PageGuide = function (pg_elem, preferences) {
        this.preferences = preferences;
        this.$base = pg_elem;
        this.$all_items = this.$base.find('#tlyPageGuide > li');
        this.$items = $([]); /* fill me with visible elements on pg expand */
        this.$message = $('#tlyPageGuideMessages');
        this.$fwd = this.$base.find('a.tlypageguide_fwd');
        this.$back = this.$base.find('a.tlypageguide_back');
        this.$welcome = $('#tlyPageGuideWelcome');
        this.cur_idx = 0;
        this.track_event = this.preferences.track_events_cb;
        this.handle_doc_switch = this.preferences.handle_doc_switch;
        this.custom_open_button = this.preferences.custom_open_button;
        this.is_open = false;
        this.targetData = {};
        this.hashTable = {};
        this.changeQueue = [];
        this.visibleTargets = [];
    };

    tl.pg.hashUrl = function () {
        return tl.pg.hashCode(window.location.href);
    };

    tl.pg.hashCode = function (str) {
        var hash = 0, i, char;
        if (str.length === 0) {
            return hash;
        }
        for (i = 0; i < str.length; i++) {
            char = str.charCodeAt(i);
            hash = ((hash<<5)-hash)+char;
            hash = hash & hash;
        }
        return hash.toString();
    };

    tl.pg.isScrolledIntoView = function(elem) {
        var dvtop = $(window).scrollTop(),
            dvbtm = dvtop + $(window).height(),
            eltop = $(elem).offset().top,
            elbtm = eltop + $(elem).height();

        return (elbtm >= dvtop) && (eltop <= dvbtm - 100);
    };

    /**
     * remove all traces of pageguide from the DOM.
     **/
    tl.pg.destroy = function () {
        $('#tlyPageGuideWrapper').remove();
        $('#tlyPageGuideOverlay').remove();
        $('.tlypageguide_shadow').removeClass('tlypageguide_shadow');
        $('body').removeClass('tlypageguide-open');
        $('body').removeClass('tlyPageGuideWelcomeOpen');
    };

    tl.pg.PageGuide.prototype.setup_welcome = function () {
        var $welcome = $('#tlyPageGuideWelcome');
        var that = this;
        if ($welcome.length > 0) {
            that.preferences.show_welcome = !that.preferences.check_welcome_dismissed();
            if (that.preferences.show_welcome) {
                if (!$('#tlyPageGuideOverlay').length) {
                    $('body').prepend('<div id="tlyPageGuideOverlay"></div>');
                }
                $welcome.appendTo(that.$base);
            }

            if ($welcome.find('.tlypageguide_ignore').length) {
                $welcome.on('click', '.tlypageguide_ignore', function () {
                    that.close_welcome();
                    that.track_event('PG.ignoreWelcome');
                });
            }
            if ($welcome.find('.tlypageguide_dismiss').length) {
                $welcome.on('click', '.tlypageguide_dismiss', function () {
                    that.close_welcome();
                    that.preferences.dismiss_welcome();
                    that.track_event('PG.dismissWelcome');
                });
            }
            $welcome.on('click', '.tlypageguide_start', function () {
                that.open();
                that.track_event('PG.startFromWelcome');
            });

            if (that.preferences.show_welcome) {
                that.pop_welcome();
            }
        }
    };

    tl.pg.PageGuide.prototype.ready = function(callback) {
        var that = this;
        tl.pg.interval = window.setInterval(function() {
                if (!$(that.preferences.loading_selector).is(':visible')) {
                    callback();
                    clearInterval(tl.pg.interval);
                }
            }, 250);
        return this;
    };

    /**
     * grab any pageguide steps on the page that have not yet been added
     * to the pg object.
     **/
    tl.pg.PageGuide.prototype.addSteps = function () {
        var self = this;
        $('#tlyPageGuide > li').each(function (i, el) {
            var $el = $(el);
            var tourTarget = $el.data('tourtarget');
            var positionClass = $el.attr('class');
            if (self.targetData[tourTarget] == null) {
                self.targetData[tourTarget] = {
                    targetStyle: {},
                    content: $el.html()
                };
                var hashCode = tl.pg.hashCode(tourTarget) + '';
                self.hashTable[hashCode] = tourTarget;
                $('#tlyPageGuideContent').append(
                    '<div class="tlypageguide_TESTshadow tlypageguide_TESTshadow' + hashCode + '">' +
                        '<span class="tlyPageGuideStepIndex ' + positionClass +'"></span>' +
                    '</div>'
                );
            }
        });
    };

    /**
     * go through all the current targets and check whether the elements are
     * on the page and visible.
     **/
    tl.pg.PageGuide.prototype.checkTargets = function () {
        var self = this;
        var visibleIndex = 0;
        var newVisibleTargets = [];
        for (var target in self.targetData) {
            var $el = $(target);
            var newTargetData = {
                targetStyle: {
                    display: (!!$el.length && $el.is(':visible')) ? 'block' : 'none'
                }
            };
            if (newTargetData.targetStyle.display) {
                var offset = $el.offset();
                $.extend(newTargetData.targetStyle, {
                    top: offset.top,
                    left: offset.left,
                    width: $el.outerWidth(),
                    height: $el.outerHeight(),
                    'z-index': $el.css('z-index')
                    // some kind of special casing for fixed positioning
                });
                visibleIndex++;
                newTargetData.index = visibleIndex;
                newVisibleTargets.push(target);
            }
            var diff = {
                target: target
            };
            // compare new styles with existing ones
            for (prop in newTargetData.targetStyle) {
                if (newTargetData.targetStyle[prop] !== self.targetData[target][prop]) {
                    if (diff.targetStyle == null) {
                        diff.targetStyle = {};
                    }
                    diff.targetStyle[prop] = newTargetData.targetStyle[prop];
                }
            }
            // compare index with existing index
            if (newTargetData.index !== self.targetData[target].index) {
                diff.index = newTargetData.index;
            }
            // push diff onto changequeue if changes have been made
            if (diff.hasOwnProperty('targetStyle') || diff.hasOwnProperty('index')) {
                self.changeQueue.push(diff);
            }
            $.extend(self.targetData[target], newTargetData);
        }
        self.visibleTargets = newVisibleTargets;
    };

    tl.pg.PageGuide.prototype.positionOverlays = function () {
        var self = this;
        for (var i=0; i<self.changeQueue.length; i++) {
            var changes = self.changeQueue[i];
            var selector = '.tlypageguide_TESTshadow' + tl.pg.hashCode(changes.target);
            var $el = $('#tlyPageGuideContent').find(selector);
            if (changes.targetStyle != null) {
                var style = $.extend({}, changes.targetStyle);
                for (var prop in style) {
                    // fix this
                    if (prop === 'z-index') {
                        style[prop] += 1;
                    } else if (typeof style[prop] === 'number') {
                        // TODO: change width, height, etc as necessary
                        style[prop] = style[prop] + 'px';
                    }
                }
                $el.css(style);
            }
            if (changes.index != null) {
                $el.find('.tlyPageGuideStepIndex').text(changes.index);
            }
        }
        self.changeQueue = [];
    };

    tl.pg.PageGuide.prototype.refreshVisibleSteps = function () {
        var self = this;
        self.addSteps();
        self.checkTargets();
        self.positionOverlays();
    };

    /* to be executed on pg expand */
    tl.pg.PageGuide.prototype._on_expand = function () {
        var self = this;

        self.refreshVisibleSteps();

        if (self.preferences.auto_show_first && self.visibleTargets.length) {
            self.show_message(0);
        }
    };

    /**
     * show the step specified by either a numeric index or a selector.
     * @index:  index of the currently visible step to show.
     **/
    tl.pg.PageGuide.prototype.show_message = function (index) {
        var self = this;
        var targetKey = self.visibleTargets[index];
        var target = self.targetData[targetKey];
        var selector = '.tlypageguide_TESTshadow' + tl.pg.hashCode(targetKey);

        $('.tlypageguide-active').removeClass('tlypageguide-active');
        $(selector).addClass('tlypageguide-active');

        self.$message.find('.tlypageguide_text').html(target.content);
        self.cur_idx = index;

        // DOM stuff
        var defaultHeight = 100;
        var oldHeight = parseFloat(self.$message.css("height"));
        self.$message.css("height", "auto");
        var height = parseFloat(self.$message.outerHeight());
        self.$message.css("height", oldHeight + 'px');
        if (height < defaultHeight) {
            height = defaultHeight;
        }
        if (height > $(window).height()/2) {
            height = $(window).height()/2;
        }
        height = height + "px";

        if (!tl.pg.isScrolledIntoView($(targetKey))) {
            $('html,body').animate({scrollTop: target.targetStyle.top - 50}, 500);
        }
        self.$message.show().animate({'height': height}, 500);
        self.roll_number(self.$message.find('span'), target.index);
    };

    tl.pg.PageGuide.prototype.navigateBack = function () {
        var self = this;
        /*
         * If -n < x < 0, then the result of x % n will be x, which is
         * negative. To get a positive remainder, compute (x + n) % n.
         */
        var new_index = (self.cur_idx + self.visibleTargets.length - 1) % self.visibleTargets.length;

        self.track_event('PG.back');
        self.show_message(new_index, true);
        return false;
    };

    tl.pg.PageGuide.prototype.navigateForward = function () {
        var self = this;
        var new_index = (self.cur_idx + 1) % self.visibleTargets.length;

        self.track_event('PG.fwd');
        self.show_message(new_index, true);
        return false;
    };

    tl.pg.PageGuide.prototype.open = function() {
        var self = this;
        if (self.preferences.show_welcome) {
            self.preferences.dismiss_welcome();
            self.close_welcome();
        }
        if (self.is_open) {
            return;
        } else {
            self.is_open = true;
        }

        self.track_event('PG.open');

        self._on_expand();
        self.$items.toggleClass('expanded');
        $('body').addClass('tlypageguide-open');
    };

    tl.pg.PageGuide.prototype.close = function() {
        var self = this;
        if (!self.is_open) {
            return;
        } else {
            self.is_open = false;
        }

        self.track_event('PG.close');

        //self.$items.toggleClass('expanded');
        // TODO: fix this
        $('.tlypageguide_TESTshadow').css('display', 'none');
        $('.tlypageguide-active').removeClass('tlypageguide-active');
        self.$message.animate({ height: "0" }, 500, function() {
            $(this).hide();
        });

        $('body').removeClass('tlypageguide-open');
    };

    tl.pg.PageGuide.prototype.setup_handlers = function () {
        var that = this;
        var self = this;

        /* interaction: open/close PG interface */
        var interactor = (that.custom_open_button == null) ?
                        this.$base.find('.tlypageguide_toggle') :
                        $(that.custom_open_button);
        interactor.off();
        interactor.on('click', function() {
            if (that.is_open) {
                that.close();
            } else if (that.preferences.show_welcome &&
                      !that.preferences.check_welcome_dismissed() &&
                      !$('body').hasClass('tlyPageGuideWelcomeOpen')) {
                that.pop_welcome();
            } else {
                that.open();
            }
            return false;
        });

        $('.tlypageguide_close', this.$message.add($('.tlypageguide_toggle')))
            .on('click', function() {
                that.close();
                return false;
        });

        /* interaction: item click */
        this.$all_items.off();
        this.$all_items.on('click', function() {
            var new_index = $(this).data('idx');
            that.track_event('PG.specific_elt');
            that.show_message(new_index);
        });

        /* interaction: fwd/back click */
        self.$fwd.on('click', function() {
            self.navigateForward();
            return false;
        });

        self.$back.on('click', function() {
            self.navigateBack();
            return false;
        });

        /* register resize callback */
        $(window).resize(function() {
            self.refreshVisibleSteps();
        });
    };

    tl.pg.PageGuide.prototype.roll_number = function (num_wrapper, new_text, left) {
        num_wrapper.animate({ 'text-indent': (left ? '' : '-') + '50px' }, 'fast', function() {
            num_wrapper.html(new_text);
            num_wrapper.css({ 'text-indent': (left ? '-' : '') + '50px' }, 'fast').animate({ 'text-indent': "0" }, 'fast');
        });
    };

    tl.pg.PageGuide.prototype.pop_welcome = function () {
        $('body').addClass('tlyPageGuideWelcomeOpen');
        this.track_event('PG.welcomeShown');
    };

    tl.pg.PageGuide.prototype.close_welcome = function () {
        $('body').removeClass('tlyPageGuideWelcomeOpen');
    };
}(jQuery));
