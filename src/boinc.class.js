process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
var http = require('http'),
    https = require('https'),
    parseString = require('xml2js').parseString,
    qs = require('querystring'),
    Promise = require('bluebird');

////
// Web Remote Procedure Calls (RPCs) for BOINC as documented on http://boinc.berkeley.edu/trac/wiki/WebRpc
// Output from RPCs are XML, but converted to JSON.
//
// failure response:
// {
//   error: {
//     error_num: [],
//     error_string: []
//   }
// }
// common error codes:
// -1: Generic error (error_string may have more info)
// -112: Invalid XML (e.g., the preferences passed to am_set_info.php are invalid)
// -136: Item not found in database (bad ID of any sort, or ID refers to an item not owned by the caller)
// -137: Name is not unique. The EMail address or team name is already in use.
// -138: Can't access database (treat same as -183)
// -161: Item not found (deprecated; treat same as -136)
// -183: Project is temporarily down
// -205: Email address has invalid syntax
// -206: Wrong password
// -207: Non-unique email address (treat same as -137)
// -208: Account creation disabled
// -209: Attach failed. Perhaps due to invalid invitation code.
module.exports = class Boinc {
  constructor(projectUrl) {
    this.projectUrl = projectUrl;
  }

  ////
  // Get project status. Can be used used to make web sites showing the server status of multiple BOINC projects. Do not poll more often than 10 minutes.
  //
  // data params:
  // xml - optional - output formatting. 0=HTML (default), 1=XML.
  //
  // return:
  // {
  //   server_status: {
  //     update_time: [],
  //     daemon_status: [{
  //       demon: {
  //         host: [],
  //         command: [],
  //         status: [],
  //       }
  //     }],
  //     database_file_states: {
  //       results_ready_to_send: [],
  //       results_in_progress: [],
  //       workunits_waiting_for_validation: [],
  //       workunits_waiting_for_assimilation: [],
  //       workunits_waiting_for_deletion: [],
  //       results_waiting_for_deletion: [],
  //       transitioner_backlog_hours: []
  //     }
  //   }
  // }
  server_status(xml=0) {
    let query = '?' + qs.stringify({xml: xml});
    return this.rpcCall(this.projectUrl + '/server_status.php' + query);
  }

  ////
  // Create an account. If the project already has an account with that email address, and a different password, it returns an error. If an account with that email address exists and has the same password, it returns the authenticator. Otherwise the project creates an account and returns the authenticator.
  // If <opaque_auth> is included in the reply, all subsequent RPCs that reference the account must supply the given string as well as the authenticator.
  //
  // data params:
  // email_addr - email address.
  // passwd_hash - The MD5 hash of the concatenation of the user's password and the lower case form of their EMail address. The user password itself is never sent in an RPC call.
  // user_name - the user name.
  // invite_code - optional - Invitation code if project requires invitation to create accounts.
  // team_name - optional - optional name of a team to put user in.
  //
  // return:
  // {
  //   account_out: {
  //     authenticator: [],
  //     opaque_auth: []     // optional
  //   }
  // }
  create_account(email_addr, passwd_hash, user_name, invite_code, team_name) {
    let queryObj = {
      email_addr: email_addr,
      passwd_hash: passwd_hash,
      user_name: user_name
    };

    if (invite_code)
      queryObj.invite_code = invite_code;
    if (team_name)
      queryObj.team_name = team_name;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/create_account.php' + query);
  }

  ////
  // If passwd_hash is given and is correct, the user's authentication string is returned. This authentication string is required for many of the other RPCs. If no paswd_hash is given and the account exists, a success message is returned. If no account with the EMail address provided exists, an error is returned.
  // If ldap_auth is non-zero and ldap_uid and passwd are given, authenticate using the LDAP_HOST specified in project.inc. If no account with the EMail address of the ldap_uid exists, a new one is created and the authenticator returned.
  //
  // data params:
  // email_addr - email address of account (ignored when ldap_auth is non-zero)
  // passwd_hash - The MD5 hash of the concatenation of the user's password and the lower case form of the account's EMail address.
  // ldap_auth - Needs to be non-zero in order to use LDAP authentication. When enabled, ldap_uid and passwd must be supplied too.
  // ldap_uid - The LDAP userid that can be found on LDAP_HOST (defined in project.inc)
  // passwd - The password authenticating the LDAP userid.
  //
  // return:
  // {
  //   account_out: {
  //     authenticator: [],
  //     opaque_auth: []
  //   }
  // }
  lookup_account(email_addr, passwd_hash, ldap_auth, ldap_uid, passwd) {
    let queryObj = {};

    if (ldap_auth) {
      queryObj = {
        ldap_auth: ldap_auth,
        ldap_uid: ldap_uid,
        passwd: passwd
      };
    } else {
      queryObj = {
        email_addr: email_addr,
        passwd_hash: passwd_hash
      };
    }

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/lookup_account.php' + query);
  }

  ////
  // returns data associated with the given account
  //
  // data params:
  // account_key - Authentication string for account to retrieve information about. Received from lookup_account
  // opaque_auth - optional - Received from lookup_account
  //
  // return:
  // {
  //   am_get_info_reply: {
  //     id: [],
  //     name: [],
  //     country: [],
  //     weak_auth: [],
  //     postal_code: [],
  //     global_prefs: {
  //       GLOBAL_PREFS
  //     },
  //     project_prefs: {
  //       PROJECT_PREFS
  //     },
  //     url: [],
  //     send_email: [],
  //     show_hosts: [],
  //     teamid: []
  //     teamleader: [] // optional
  //   }
  // }
  am_get_info(account_key, opaque_auth) {
    let queryObj = {account_key: account_key};

    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;

    let query = '?' + qs.stringify(queryObj);
    return this.rpcCall(this.projectUrl + '/am_get_info.php' + query);
  }

  ////
  // Updates one or more attributes of the given account. If email address is changed, you must also change the password hash. If the project uses opaque_auth, then it will be returned on the reply.
  //
  // data params:
  // account_key - Authentication string of user account being changed. Received from lookup_account.
  // opaque_auth - optional - Received from lookup_account
  // name - optional
  // country - optional
  // postal_code - optional
  // global_prefs - optional
  // project_prefs - optional
  // url - optional
  // send_email - optional
  // show_hosts - optional
  // teamid - optional - zero means quit current team, if any
  // venue - optional
  // email_addr - optional
  // password_hash - optional - The password hash is MD5(password+lower_case(email_addr)).
  //
  // return:
  // {
  //   am_set_info_reply: {
  //     success: [''],
  //     opaque_auth: [] // optional
  //   }
  // }
  am_set_info(account_key, opaque_auth, name, country, postal_code, global_prefs, url, send_email, show_hosts, teamid, venue, email_addr, password_hash) {
    let queryObj = {account_key: account_key};

    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;
    if (name)
      queryObj.name = name;
    if (country)
      queryObj.country = country;
    if (postal_code)
      queryObj.postal_code = postal_code;
    if (global_prefs)
      queryObj.global_prefs = global_prefs;
    if (url)
      queryObj.url = url;
    if (send_email)
      queryObj.send_email = send_email;
    if (show_hosts)
      queryObj.show_hosts = show_hosts;
    if (teamid)
      queryObj.teamid = teamid;
    if (venue)
      queryObj.venue = venue;
    if (email_addr)
      queryObj.email_addr = email_addr;
    if (password_hash)
      queryObj.password_hash = password_hash;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/am_set_info.php' + query);
  }

  ////
  // Updates the host's venue
  //
  // data params:
  // account_key - Authentication string of user account being changed. Received from lookup_account.
  // hostid
  // venue
  // opaque_auth - optional - Received from lookup_account
  //
  // return:
  // {
  //   am_set_host_info_reply: {
  //     success: ['']
  //   }
  // }
  am_set_host_info(account_key, hostid, venue, opaque_auth) {
    let queryObj = {
      account_key: account_key,
      hostid: hostid,
      venue: venue
    };

    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/am_set_host_info.php' + query);
  }

  ////
  // Returns info about an account. If called with the authentication string, returns a list of hosts associated with the account.
  //
  // data params:
  // userid - User ID to display. Either id or auth must be specified.
  // auth - Authentication string of user to display. Either id or auth must be specified. Received from lookup_account. //TBC: might be account_key as with other calls
  // opaque_auth - optional - Received from lookup_account
  // format - optional - output formatting. 'xml' is only supported value (default is HTML formatting)
  //
  // return:
  // {
  //   user: {
  //     id: [],
  //     cpid: [],
  //     create_time: [],
  //     name: [],
  //     country: [],
  //     total_credit: [],
  //     expavg_credit: [],
  //     expavg_time: [],
  //     teamid: [],
  //     url: [],
  //     has_profile: [],
  //     host: [{  // only if auth was sent
  //       id: [],
  //       create_time: [],
  //       rpc_seqno: [],
  //       host_cpid: [],
  //       total_credit: [],
  //       expavg_credit: [],
  //       expavg_time: [],
  //       domain_name: [],
  //       p_ncpus: [],
  //       p_vendor: [],
  //       p_model: [],
  //       p_fpops: [],
  //       p_iops: [],
  //       os_name: [],
  //       os_version: []
  //     }]
  //   }
  // }
  show_user(userid, auth, opaque_auth, format) {
    let queryObj = {};

    if (userid)
      queryObj.userid = userid;
    else
      queryObj.auth = auth;
    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;
    if (format === 'xml')
      queryObj.format = format;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/show_user.php' + query);
  }

  ////
  // Get status of results (for work unit validation)
  // Descriptions of those result, including most of the DB fields such as server status, granted credit, etc.
  //
  // data params:
  // ids - comma-separated list of result IDs (provide either ids or names)
  // names - comma-separated list of result names (provide either ids or names)
  //
  // return:
  // {
  //   results: [{
  //     result: {
  //       id: [],
  //       create_time: [],
  //       workunitid: [],
  //       server_state: [],
  //       outcome: [],
  //       client_state: [],
  //       hostid: [],
  //       userid: [],
  //       report_deadline: [],
  //       sent_time: [],
  //       received_time: [],
  //       name: [],
  //       cpu_time: [],
  //       batch: [],
  //       file_delete_state: [],
  //       validate_state: [],
  //       granted_credit: [],
  //       app_version_num: [],
  //       appid: [],
  //       exit_status: [],
  //       elapsed_time: [],
  //       flops_estimate: [],
  //       peak_working_set_size: [],
  //       peak_swap_size: [],
  //       peak_disk_usage: []
  //     }
  //   }]
  // }
  result_status(ids, names) {
    let queryObj = {};

    if (ids)
      queryObj.ids = ids;
    else
      queryObj.names = names;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/result_status.php' + query);
  }

  ////
  // Creates a team
  //
  // data params:
  // account_key - Authentication string of team founder's user account. Either id or auth must be specified. Received from lookup_account.
  // name - name of team
  // type - one of these types. (http://boinc.berkeley.edu/team_types.php)
  // opaque_auth - optional - Received from lookup_account
  // url - optional - team url.
  // name_html - optional - team name, with HTML formatting.
  // description - optional - text describing team.
  // country - optional - team country (if present, must be one of these countries - http://boinc.berkeley.edu/countries.php).
  //
  // return:
  // {
  //   create_team_reply: {
  //     success: [''],
  //     teamid: []
  //   }
  // }
  create_team(account_key, name, type, opaque_auth, url, name_html, description, country) {
    let queryObj = {
      account_key: account_key,
      name: name,
      type: type
    };

    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;
    if (url)
      queryObj.url = url;
    if (name_html)
      queryObj.name_html = name_html;
    if (description)
      queryObj.description = description;
    if (country)
      queryObj.country = country;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/create_team.php' + query);
  }

  ////
  // Teams with names matching *string* will be returned. A maximum of 100 teams will be returned.
  //
  // data params:
  // team_name - Substring of team name
  // format - optional - Output formatting. 'xml' is only supported value (deafult is HTML formatting)
  //
  // return:
  // {
  //   teams: [{
  //     id: [],
  //     name: [],
  //     country: []
  //   }]
  // }
  team_name(team_name, format) {
    let queryObj = {team_name: team_name};

    if (format === 'xml')
      queryObj.format = format;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/team_lookup.php' + query);
  }

  ////
  // Show info on team with the given ID.
  //
  // data params:
  // team_id - Team number of the team to lookup.
  //
  // return:
  // {
  //   team: {
  //     id: [],
  //     create_time: [],
  //     userid: [],
  //     name: [],
  //     url: [],
  //     type: [],
  //     country: [],
  //     total_credit: [],
  //     expavg_credit: [],
  //     expavg_time: []
  //   }
  // }
  team_lookup(team_id) {
    let query = '?' + qs.stringify({team_id: team_id});

    return this.rpcCall(this.projectUrl + '/team_lookup.php' + query);
  }

  ////
  // Show list of team members. If authentication string is that of a team administrator, show email addresses, and flag indicating whether the user opted out of getting emails.
  //
  // data param:
  // teamid - database ID of team
  // account_key - optional - Authentication string of a team administrator's user account. Received from lookup_account.
  // opaque_auth - optional - Received from lookup_account.
  // xml - output formatting. 0=HTML, 1=XML. (default is 0)
  //
  // return:
  // {
  //   users: [{
  //     user: {
  //       id: [],
  //       email_addr: [], // optional
  //       email_ok: [], // optional
  //       cpid: [],
  //       create_time: [],
  //       name: [],
  //       country: [],
  //       total_credit: [],
  //       expavg_credit: [],
  //       expavg_time: [],
  //       url: [],
  //       has_profile: []
  //     }
  //   }]
  // }
  team_email_list(teamid, account_key, opaque_auth, xml=0) {
    let queryObj = {
      teamid: teamid,
      xml: xml
    };

    if (account_key)
      queryObj.account_key = account_key;
    if (opaque_auth)
      queryObj.opaque_auth = opaque_auth;

    let query = '?' + qs.stringify(queryObj);

    return this.rpcCall(this.projectUrl + '/team_email_list.php' + query);
  }

  rpcCall(url) {
    let self = this;
    return new Promise((resolve, reject) => {
      "use strict";

      if (self.projectUrl.indexOf('https') > -1) {
        https.get(url, (response) => {
          let output = "";
          response.on('data', (data) => {
            output += data;
          }).on('end', () => {
            parseString(output, (err, result) => {
              if (err)
                reject(console.log(err));
              else
                resolve(result);
            });
          });
        });
      } else {
        http.get(url, (response) => {
          let output = "";
          response.on('data', (data) => {
            output += data;
          }).on('end', () => {
            parseString(output, (err, result) => {
              if (err)
                reject(console.log(err));
              else
                resolve(result);
            });
          });
        });
      }
    });
  }
};
